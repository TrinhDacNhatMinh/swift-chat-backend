import {
  Inject,
  Logger,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from '../redis/redis.module';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserService } from '../user/user.service';
import { ChatService } from './chat.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { RoomEventDto } from './dto/room-event.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';

const REDIS_PRESENCE_PREFIX = 'presence:';
const REDIS_CONNECTION_COUNT_PREFIX = 'conn_count:';
const PRESENCE_TTL_SECONDS = 120;

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
@UseGuards(WsJwtGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(REDIS_PUB_CLIENT) private readonly pubClient: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly subClient: Redis,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly chatService: ChatService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ChatGateway initialized');
    this.chatService.setServer(server);

    server.use(async (socket: Socket, next) => {
      const token = this.extractToken(socket);

      if (!token) {
        return next(new Error('Authentication token is required'));
      }

      try {
        const payload = this.jwtService.verify<JwtPayload>(token, {
          secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        socket.data.userId = payload.sub;
        socket.data.email = payload.email;

        try {
          const user = await this.userService.findById(payload.sub);
          socket.data.username = user.username;
        } catch {
          socket.data.username = payload.email;
        }

        next();
      } catch {
        next(new Error('Invalid or expired authentication token'));
      }
    });
  }

  async handleConnection(client: Socket) {
    const userId = client.data.userId as string;
    this.logger.log(`Client connected: ${client.id} (userId: ${userId})`);

    await client.join(`user:${userId}`);

    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    const newCount = await this.redisClient.incr(countKey);
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);

    if (newCount === 1) {
      await this.redisClient.set(
        `${REDIS_PRESENCE_PREFIX}${userId}`,
        'online',
        'EX',
        PRESENCE_TTL_SECONDS,
      );
      await this.chatService.broadcastPresenceToFriends(userId, 'online');
    } else {
      await this.redisClient.expire(
        `${REDIS_PRESENCE_PREFIX}${userId}`,
        PRESENCE_TTL_SECONDS,
      );
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string;
    this.logger.log(`Client disconnected: ${client.id} (userId: ${userId})`);

    if (!userId) return;

    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    const remainingCount = await this.redisClient.decr(countKey);

    if (remainingCount <= 0) {
      await this.redisClient.del(countKey);
      await this.redisClient.del(`${REDIS_PRESENCE_PREFIX}${userId}`);
      await this.chatService.broadcastPresenceToFriends(userId, 'offline');

      try {
        await this.userService.updateLastSeen(userId);
      } catch (error) {
        this.logger.error(
          `Failed to update lastSeen for user ${userId}:`,
          error,
        );
      }
    }
  }

  @SubscribeMessage('chat:join_room')
  async handleJoinRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.joinRoom(client.data.userId, dto.conversationId);
    await client.join(`conversation:${dto.conversationId}`);
    return { status: 'success', conversationId: dto.conversationId };
  }

  @SubscribeMessage('chat:leave_room')
  async handleLeaveRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    await client.leave(`conversation:${dto.conversationId}`);
    return { status: 'success', conversationId: dto.conversationId };
  }

  @SubscribeMessage('chat:typing')
  async handleTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(`conversation:${dto.conversationId}`).emit('chat:user_typing', {
      conversationId: dto.conversationId,
      userId: client.data.userId,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('chat:stop_typing')
  async handleStopTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    client
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:user_stop_typing', {
        conversationId: dto.conversationId,
        userId: client.data.userId,
      });
  }

  @SubscribeMessage('chat:send_message')
  async handleSendMessage(
    @MessageBody() dto: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const senderName = client.data.username || client.data.email || 'Someone';

    const savedMessage = await this.chatService.sendMessage(
      userId,
      senderName,
      dto,
    );

    const responsePayload = {
      ...savedMessage.toObject(),
      clientTempId: dto.clientTempId,
    };

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:receive_message', responsePayload);

    return { status: 'sent', messageId: savedMessage._id };
  }

  @SubscribeMessage('chat:delete_message')
  async handleDeleteMessage(
    @MessageBody() dto: DeleteMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.deleteMessage(client.data.userId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_deleted', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        deletedBy: client.data.userId,
        timestamp: new Date().toISOString(),
      });

    return { status: 'deleted', messageId: dto.messageId };
  }

  @SubscribeMessage('chat:edit_message')
  async handleEditMessage(
    @MessageBody() dto: EditMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.editMessage(client.data.userId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_edited', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        content: dto.content,
        editedBy: client.data.userId,
        timestamp: new Date().toISOString(),
      });

    return { status: 'edited', messageId: dto.messageId };
  }

  @SubscribeMessage('chat:mark_read')
  async handleMarkRead(
    @MessageBody() dto: MarkReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.markRead(client.data.userId, dto);

    client.to(`conversation:${dto.conversationId}`).emit('chat:read_receipt', {
      conversationId: dto.conversationId,
      userId: client.data.userId,
      messageId: dto.messageId,
      timestamp: new Date().toISOString(),
    });

    return { status: 'success' };
  }

  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string;
    if (!userId) return;

    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);
    await this.redisClient.expire(
      `${REDIS_PRESENCE_PREFIX}${userId}`,
      PRESENCE_TTL_SECONDS,
    );

    return { status: 'ok' };
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const authHeader = client.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

    return undefined;
  }
}
