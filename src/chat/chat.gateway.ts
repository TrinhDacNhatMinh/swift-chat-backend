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
import { DeleteMessageDto } from './dto/delete-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { UserService } from '../user/user.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FcmService } from '../fcm/fcm.service';

const REDIS_PRESENCE_PREFIX = 'presence:';
const REDIS_CONNECTION_COUNT_PREFIX = 'conn_count:';
const PRESENCE_TTL_SECONDS = 120; // 2 minutes — heartbeat must refresh before expiry

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
    private readonly userService: UserService,
    private readonly notificationsService: NotificationsService,
    private readonly fcmService: FcmService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('ChatGateway initialized');
    this.notificationsService.setServer(server);

    // Handshake middleware — reject unauthenticated connections early
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

        // Fix #4: Load username from DB so FCM push notifications use real name
        try {
          const user = await this.userService.findById(payload.sub);
          socket.data.username = user.username;
        } catch {
          socket.data.username = payload.email; // Fallback to email
        }

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

    // Handle presence tracking with TTL safety net (Bug 3 fix)
    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    const newCount = await this.redisClient.incr(countKey);
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);
    
    // If it's the first connection, mark as online and notify friends
    if (newCount === 1) {
      await this.redisClient.set(`${REDIS_PRESENCE_PREFIX}${userId}`, 'online', 'EX', PRESENCE_TTL_SECONDS);
      await this.broadcastPresenceToFriends(userId, 'online');
    } else {
      // Refresh TTL on presence key for subsequent connections
      await this.redisClient.expire(`${REDIS_PRESENCE_PREFIX}${userId}`, PRESENCE_TTL_SECONDS);
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

      // Bug 2 fix: Record last seen timestamp
      try {
        await this.userService.updateLastSeen(userId);
      } catch (error) {
        this.logger.error(`Failed to update lastSeen for user ${userId}:`, error);
      }
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

  // Feature 1: Typing Indicator
  @SubscribeMessage('chat:typing')
  async handleTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const isParticipant = await this.conversationsService.isParticipant(userId, dto.conversationId);
    if (!isParticipant) return;

    // Broadcast to room except the sender
    client.to(`conversation:${dto.conversationId}`).emit('chat:user_typing', {
      conversationId: dto.conversationId,
      userId,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('chat:stop_typing')
  async handleStopTyping(
    @MessageBody() dto: RoomEventDto,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(`conversation:${dto.conversationId}`).emit('chat:user_stop_typing', {
      conversationId: dto.conversationId,
      userId: client.data.userId,
    });
  }

  // Step 5: Send and Broadcast Message Logic
  @SubscribeMessage('chat:send_message')
  async handleSendMessage(
    @MessageBody() dto: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const conversationId = dto.conversationId;

    // Fix #2: Verify conversation exists before any operation
    const conversationValid = await this.conversationsService.conversationExists(conversationId);
    if (!conversationValid) {
      throw new WsException('Conversation not found');
    }

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

    // Bug 1 fix: Update conversation timestamp so list sorts correctly
    await this.conversationsService.updateTimestamp(conversationId);

    // Construct response payload including client's temp ID for optimistic UI correlation
    const responsePayload = {
      ...savedMessage.toObject(),
      clientTempId: dto.clientTempId, // Re-attach for client side UI sync
    };

    // 2. Broadcast message to entire conversation room
    this.server
      .to(`conversation:${conversationId}`)
      .emit('chat:receive_message', responsePayload);

    // Feature 4: Send offline push notification (fire-and-forget)
    // Fix #4: Use loaded username from handshake instead of potentially undefined value
    this.fcmService
      .sendPushToOfflineParticipants(conversationId, userId, client.data.username || client.data.email || 'Someone', dto.content)
      .catch((err) => this.logger.error('FCM push failed:', err));

    return { status: 'sent', messageId: savedMessage._id };
  }

  // Feature 5: Delete Message
  @SubscribeMessage('chat:delete_message')
  async handleDeleteMessage(
    @MessageBody() dto: DeleteMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const deleted = await this.messagesService.softDelete(dto.messageId, userId);

    if (!deleted) {
      throw new WsException('Message not found or you are not the sender');
    }

    this.server.to(`conversation:${dto.conversationId}`).emit('chat:message_deleted', {
      conversationId: dto.conversationId,
      messageId: dto.messageId,
      deletedBy: userId,
      timestamp: new Date().toISOString(),
    });

    return { status: 'deleted', messageId: dto.messageId };
  }

  // Feature 6: Edit Message
  @SubscribeMessage('chat:edit_message')
  async handleEditMessage(
    @MessageBody() dto: EditMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    const edited = await this.messagesService.editMessage(dto.messageId, userId, dto.content);

    if (!edited) {
      throw new WsException('Message not found, already deleted, or you are not the sender');
    }

    this.server.to(`conversation:${dto.conversationId}`).emit('chat:message_edited', {
      conversationId: dto.conversationId,
      messageId: dto.messageId,
      content: dto.content,
      editedBy: userId,
      timestamp: new Date().toISOString(),
    });

    return { status: 'edited', messageId: dto.messageId };
  }

  // Feature 2: Read Receipts
  @SubscribeMessage('chat:mark_read')
  async handleMarkRead(
    @MessageBody() dto: MarkReadDto,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    await this.conversationsService.markAsRead(userId, dto.conversationId, dto.messageId);
    
    // Broadcast read receipt to other participants
    client.to(`conversation:${dto.conversationId}`).emit('chat:read_receipt', {
      conversationId: dto.conversationId,
      userId,
      messageId: dto.messageId,
      timestamp: new Date().toISOString(),
    });

    return { status: 'success' };
  }

  // Bug 3 fix: Heartbeat to keep presence alive — client should emit every 30-60s
  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string;
    if (!userId) return;

    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${userId}`;
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);
    await this.redisClient.expire(`${REDIS_PRESENCE_PREFIX}${userId}`, PRESENCE_TTL_SECONDS);

    return { status: 'ok' };
  }

  // Helper for Presence Broadcasting
  private async broadcastPresenceToFriends(
    userId: string,
    status: 'online' | 'offline',
  ) {
    try {
      const friends = await this.friendsService.getAllFriends(userId);
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
