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
  WsException,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from '../redis/redis.module';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { FriendsService } from '../friends/friends.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { RoomEventDto } from './dto/room-event.dto';

const REDIS_PRESENCE_PREFIX = 'presence:';
const REDIS_CONNECTION_COUNT_PREFIX = 'conn_count:';

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
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly friendsService: FriendsService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ChatGateway initialized');

    // Handshake middleware — reject unauthenticated connections early
    server.use((socket: Socket, next) => {
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
        next();
      } catch {
        next(new Error('Invalid or expired authentication token'));
      }
    });
  }

  async handleConnection(client: Socket) {
    const userId = client.data.userId as string;
    
    this.logger.log(
      `Client connected: ${client.id} (userId: ${userId})`,
    );

    // Join the personal user room for unified addressing across devices
    await client.join(`user:${userId}`);

    // Handle presence tracking
    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    const newCount = await this.redisClient.incr(countKey);
    
    // If it's the first connection, mark as online and notify friends
    if (newCount === 1) {
      await this.redisClient.set(`${REDIS_PRESENCE_PREFIX}${userId}`, 'online');
      await this.broadcastPresenceToFriends(userId, 'online');
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string;
    
    this.logger.log(
      `Client disconnected: ${client.id} (userId: ${userId})`,
    );

    if (!userId) return;

    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    const remainingCount = await this.redisClient.decr(countKey);

    // If zero connections left, user is fully offline
    if (remainingCount <= 0) {
      await this.redisClient.del(countKey); // Clean up counter
      await this.redisClient.del(`${REDIS_PRESENCE_PREFIX}${userId}`);
      await this.broadcastPresenceToFriends(userId, 'offline');
    }
  }

  // Step 4: Join Room Logic
  @SubscribeMessage('chat:join_room')
  async handleJoinRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const conversationId = dto.conversationId;

    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      conversationId,
    );

    if (!isParticipant) {
      throw new WsException('You are not a participant of this conversation');
    }

    await client.join(`conversation:${conversationId}`);
    this.logger.log(`User ${userId} joined room for conversation ${conversationId}`);

    return { status: 'success', conversationId };
  }

  // Step 4: Leave Room Logic
  @SubscribeMessage('chat:leave_room')
  async handleLeaveRoom(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    const conversationId = dto.conversationId;
    await client.leave(`conversation:${conversationId}`);
    return { status: 'success', conversationId };
  }

  // Step 5: Send and Broadcast Message Logic
  @SubscribeMessage('chat:send_message')
  async handleSendMessage(
    @MessageBody() dto: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const conversationId = dto.conversationId;

    // Verify authorization again for security
    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      conversationId,
    );

    if (!isParticipant) {
      throw new WsException('Permission denied to send message');
    }

    // 1. Persist message to database first
    const savedMessage = await this.messagesService.create(userId, dto);

    // Construct response payload including client's temp ID for optimistic UI correlation
    const responsePayload = {
      ...savedMessage.toObject(),
      clientTempId: dto.clientTempId, // Re-attach for client side UI sync
    };

    // 2. Broadcast message to entire conversation room
    this.server
      .to(`conversation:${conversationId}`)
      .emit('chat:receive_message', responsePayload);

    return { status: 'sent', messageId: savedMessage._id };
  }

  // Helper for Presence Broadcasting
  private async broadcastPresenceToFriends(
    userId: string,
    status: 'online' | 'offline',
  ) {
    try {
      const friends = await this.friendsService.getFriends(userId);
      const payload = {
        userId,
        status,
        timestamp: new Date().toISOString(),
      };

      // Emit specifically to each friend's generic user room
      friends.forEach((friend) => {
        this.server.to(`user:${friend.id}`).emit('presence:status', payload);
      });
    } catch (error) {
      this.logger.error(`Failed to broadcast presence for user ${userId}:`, error);
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken;
    }

    const authHeader = client.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return undefined;
  }
}
