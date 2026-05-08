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
import { Throttle } from '@nestjs/throttler';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { WsThrottlerGuard } from '../common/guards/ws-throttler.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserService } from '../user/user.service';
import { ChatService } from './chat.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { RoomEventDto } from './dto/room-event.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { PinMessageDto } from './dto/pin-message.dto';
import { GatewayStatus } from '../common/enums/gateway.enum';
import { RATE_LIMIT } from '../common/constants/cache.constants';
import { CONFIG_KEYS } from '../common/constants/config.constants';

@WebSocketGateway({
  namespace: '/chat',
})
@UseGuards(WsJwtGuard, WsThrottlerGuard)
@Throttle({
  default: { limit: RATE_LIMIT.DEFAULT_LIMIT, ttl: RATE_LIMIT.DEFAULT_TTL_MS },
})
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
    private readonly socketEmitterService: SocketEmitterService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ChatGateway initialized');
    this.socketEmitterService.setServer(server);

    server.use((socket: Socket, next) => {
      const runAuth = async () => {
        const token = this.extractToken(socket);

        if (!token) {
          return next(new Error('Authentication token is required'));
        }

        try {
          const payload = this.jwtService.verify<JwtPayload>(token, {
            secret: this.configService.getOrThrow<string>(
              CONFIG_KEYS.JWT_ACCESS_SECRET,
            ),
          });
          socket.data.accountId = payload.sub;
          socket.data.email = payload.email;

          try {
            const account = await this.userService.findById(payload.sub);
            socket.data.username = account.username;
          } catch {
            socket.data.username = payload.email;
          }

          next();
        } catch {
          next(new Error('Invalid or expired authentication token'));
        }
      };

      void runAuth();
    });
  }

  async handleConnection(client: Socket) {
    const accountId = client.data.accountId as string;
    this.logger.log(`Client connected: ${client.id} (accountId: ${accountId})`);
    await client.join(`account:${accountId}`);
    await this.chatService.onClientConnected(accountId);
  }

  async handleDisconnect(client: Socket) {
    const accountId = client.data.accountId as string;
    this.logger.log(
      `Client disconnected: ${client.id} (accountId: ${accountId})`,
    );
    if (!accountId) return;
    await this.chatService.onClientDisconnected(accountId);
  }

  @SubscribeMessage('chat:join_room')
  async handleJoinRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.joinRoom(client.data.accountId, dto.conversationId);
    await client.join(`conversation:${dto.conversationId}`);
    return {
      status: GatewayStatus.SUCCESS,
      conversationId: dto.conversationId,
    };
  }

  @SubscribeMessage('chat:rejoin_rooms')
  async handleRejoinRooms(@ConnectedSocket() client: Socket) {
    const accountId = client.data.accountId as string;
    const { data: conversations } =
      await this.chatService.getUserConversations(accountId);

    for (const conv of conversations) {
      await client.join(`conversation:${conv.id}`);
    }

    return { status: GatewayStatus.OK, rejoined: conversations.length };
  }

  @SubscribeMessage('chat:leave_room')
  async handleLeaveRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    await client.leave(`conversation:${dto.conversationId}`);
    return {
      status: GatewayStatus.SUCCESS,
      conversationId: dto.conversationId,
    };
  }

  @SubscribeMessage('chat:typing')
  handleTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(`conversation:${dto.conversationId}`).emit('chat:user_typing', {
      conversationId: dto.conversationId,
      accountId: client.data.accountId,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('chat:stop_typing')
  handleStopTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    client
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:user_stop_typing', {
        conversationId: dto.conversationId,
        accountId: client.data.accountId,
      });
  }

  @SubscribeMessage('chat:send_message')
  async handleSendMessage(
    @MessageBody() dto: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const accountId = client.data.accountId;
    const senderName = client.data.username || client.data.email || 'Someone';

    const savedMessage = await this.chatService.sendMessage(
      accountId,
      senderName,
      dto,
    );

    const responsePayload = {
      ...savedMessage,
      clientTempId: dto.clientTempId,
    };

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:receive_message', responsePayload);

    return { status: GatewayStatus.SENT, messageId: savedMessage.id };
  }

  @SubscribeMessage('chat:unsend_message')
  async handleUnsendMessage(
    @MessageBody() dto: DeleteMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.unsendMessage(client.data.accountId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_unsent', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        unsentBy: client.data.accountId,
        timestamp: new Date().toISOString(),
      });

    return { status: GatewayStatus.UNSENT, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:delete_for_me')
  async handleDeleteForMe(
    @MessageBody() dto: DeleteMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.deleteForMe(client.data.accountId, dto);
    client.emit('chat:message_deleted_for_me', {
      conversationId: dto.conversationId,
      messageId: dto.messageId,
      timestamp: new Date().toISOString(),
    });

    return { status: GatewayStatus.DELETED_FOR_ME, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:edit_message')
  async handleEditMessage(
    @MessageBody() dto: EditMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.editMessage(client.data.accountId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_edited', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        content: dto.content,
        editedBy: client.data.accountId,
        timestamp: new Date().toISOString(),
      });

    return { status: GatewayStatus.EDITED, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:mark_read')
  async handleMarkRead(
    @MessageBody() dto: MarkReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.markRead(client.data.accountId, dto);

    client.to(`conversation:${dto.conversationId}`).emit('chat:read_receipt', {
      conversationId: dto.conversationId,
      accountId: client.data.accountId,
      messageId: dto.messageId,
      timestamp: new Date().toISOString(),
    });

    return { status: GatewayStatus.SUCCESS };
  }

  @SubscribeMessage('chat:react_message')
  async handleReactMessage(
    @MessageBody() dto: ReactMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const updatedMessage = await this.chatService.reactMessage(
      client.data.accountId,
      dto,
    );

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:reaction_updated', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        reactions: updatedMessage.reactions,
      });

    return { status: GatewayStatus.SUCCESS, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:pin_message')
  async handlePinMessage(
    @MessageBody() dto: PinMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.pinMessage(client.data.accountId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_pinned', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        pinnedBy: client.data.accountId,
        timestamp: new Date().toISOString(),
      });

    return { status: GatewayStatus.SUCCESS, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:unpin_message')
  async handleUnpinMessage(
    @MessageBody() dto: PinMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.unpinMessage(client.data.accountId, dto);

    this.server
      .to(`conversation:${dto.conversationId}`)
      .emit('chat:message_unpinned', {
        conversationId: dto.conversationId,
        messageId: dto.messageId,
        timestamp: new Date().toISOString(),
      });

    return { status: GatewayStatus.SUCCESS, messageId: dto.messageId };
  }

  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const accountId = client.data.accountId as string;
    if (!accountId) return;
    await this.chatService.onClientHeartbeat(accountId);
    return { status: GatewayStatus.OK };
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const authHeader = client.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

    return undefined;
  }
}
