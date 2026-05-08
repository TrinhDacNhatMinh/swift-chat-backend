import { Injectable, Inject, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { FriendsService } from '../friends/friends.service';
import { FcmService } from '../fcm/fcm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserService } from '../user/user.service';
import { BlockService } from '../block/block.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { NotificationType } from '@prisma/client';
import { PinMessageDto } from './dto/pin-message.dto';
import { MessageResponseDto } from '../messages/dto/message-response.dto';
import { CursorPaginatedResponse } from '../common/types/response.types';
import { ConversationType } from '@prisma/client';
import { ConversationListItemDto } from '../conversations/dto/conversation-response.dto';
import { PresenceStatus } from '../common/enums/presence.enum';

const REDIS_PRESENCE_PREFIX = 'presence:';
const REDIS_CONNECTION_COUNT_PREFIX = 'conn_count:';
const PRESENCE_TTL_SECONDS = 120;

const PRESENCE_BROADCAST_BATCH_SIZE = 100;
const MAX_CONVERSATIONS_TO_REJOIN = 200;
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly friendsService: FriendsService,
    private readonly fcmService: FcmService,
    private readonly notificationsService: NotificationsService,
    private readonly userService: UserService,
    private readonly blockService: BlockService,
    private readonly prisma: PrismaService,
    private readonly socketEmitterService: SocketEmitterService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  /**
   * Handle a new WebSocket client connection.
   * Increments the Redis connection counter and marks the user online
   * on first connection, broadcasting presence to contacts.
   */
  async onClientConnected(accountId: string): Promise<void> {
    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${accountId}`;
    const newCount = await this.redisClient.incr(countKey);
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);

    if (newCount === 1) {
      await this.redisClient.set(
        `${REDIS_PRESENCE_PREFIX}${accountId}`,
        'online',
        'EX',
        PRESENCE_TTL_SECONDS,
      );
      await this.broadcastPresenceToContacts(accountId, PresenceStatus.ONLINE);
    } else {
      await this.redisClient.expire(
        `${REDIS_PRESENCE_PREFIX}${accountId}`,
        PRESENCE_TTL_SECONDS,
      );
    }
  }

  /**
   * Handle a WebSocket client disconnection.
   * Decrements the Redis connection counter atomically (Lua) and marks
   * the user offline + updates lastSeen when the last connection drops.
   */
  async onClientDisconnected(accountId: string): Promise<void> {
    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${accountId}`;
    const presenceKey = `${REDIS_PRESENCE_PREFIX}${accountId}`;

    const luaScript = `
      local count = redis.call('DECR', KEYS[1])
      if count <= 0 then
        redis.call('DEL', KEYS[1])
        redis.call('DEL', KEYS[2])
        return 0
      end
      return count
    `;

    const remainingCount = (await this.redisClient.eval(
      luaScript,
      2,
      countKey,
      presenceKey,
    )) as number;

    if (remainingCount <= 0) {
      await this.broadcastPresenceToContacts(accountId, PresenceStatus.OFFLINE);
      try {
        await this.userService.updateLastSeen(accountId);
      } catch (error) {
        this.logger.error(
          `Failed to update lastSeen for account ${accountId}:`,
          error,
        );
      }
    }
  }

  /** Renew presence TTL for an active heartbeat. */
  async onClientHeartbeat(accountId: string): Promise<void> {
    const countKey = `${REDIS_CONNECTION_COUNT_PREFIX}${accountId}`;
    await this.redisClient.expire(countKey, PRESENCE_TTL_SECONDS);
    await this.redisClient.expire(
      `${REDIS_PRESENCE_PREFIX}${accountId}`,
      PRESENCE_TTL_SECONDS,
    );
  }

  async joinRoom(accountId: string, conversationId: string): Promise<boolean> {
    const isParticipant = await this.conversationsService.isParticipant(
      accountId,
      conversationId,
    );
    if (!isParticipant) {
      throw new WsException('You are not a participant of this conversation');
    }
    return true;
  }

  /**
   * Validate conversation membership, enforce block rules for DMs,
   * persist the message, trigger mention notifications, and dispatch
   * FCM push to offline participants (fire-and-forget).
   */
  async sendMessage(
    accountId: string,
    senderName: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const conversationId = dto.conversationId;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (!conversation) {
      throw new WsException('Conversation not found');
    }

    const isParticipant = conversation.participants.some(
      (p) => p.accountId === accountId,
    );
    if (!isParticipant) {
      throw new WsException('Permission denied to send message');
    }

    // Skip the block check for group conversations
    if (conversation.type === ConversationType.direct) {
      const otherParticipant = conversation.participants.find(
        (p) => p.accountId !== accountId,
      );
      if (otherParticipant) {
        const isBlocked = await this.blockService.isBlockedEitherDirection(
          accountId,
          otherParticipant.accountId,
        );
        if (isBlocked) {
          throw new WsException(
            'Cannot send message, you are blocked by this user',
          );
        }
      }
    }

    const savedMessage = await this.messagesService.create(accountId, dto);
    await this.conversationsService.updateTimestamp(conversationId);
    if (conversation.type === ConversationType.direct) {
      await this.conversationsService.resetHiddenAt(conversationId);
    }

    // Notify each mentioned user
    if (dto.mentions && dto.mentions.length > 0) {
      await Promise.all(
        dto.mentions.map((mentionedUserId) =>
          this.notificationsService.create(
            mentionedUserId,
            accountId,
            NotificationType.MENTION,
            savedMessage.id,
          ),
        ),
      );
    }

    // Fire-and-forget: push notification to offline participants via FCM
    this.fcmService
      .sendPushToOfflineParticipants(
        conversationId,
        accountId,
        senderName,
        dto.content ?? '',
      )
      .catch((err) => this.logger.error('FCM push failed:', err));

    return savedMessage;
  }

  async unsendMessage(
    accountId: string,
    dto: DeleteMessageDto,
  ): Promise<MessageResponseDto> {
    // Guard: membership check before touching any message data
    await this.assertParticipant(accountId, dto.conversationId);

    const unsent = await this.messagesService.unsendMessage(
      dto.messageId,
      accountId,
    );
    if (!unsent) {
      throw new WsException('Message not found or you are not the sender');
    }
    return unsent;
  }

  async deleteForMe(
    accountId: string,
    dto: DeleteMessageDto,
  ): Promise<MessageResponseDto> {
    await this.assertParticipant(accountId, dto.conversationId);

    const deleted = await this.messagesService.deleteForMe(
      dto.messageId,
      accountId,
    );
    if (!deleted) {
      throw new WsException('Message not found');
    }
    return deleted;
  }

  async editMessage(
    accountId: string,
    dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    // Guard: membership check before touching any message data
    await this.assertParticipant(accountId, dto.conversationId);

    const edited = await this.messagesService.editMessage(
      dto.messageId,
      accountId,
      dto.content,
    );
    if (!edited) {
      throw new WsException(
        'Message not found, already deleted, or you are not the sender',
      );
    }
    return edited;
  }

  async markRead(accountId: string, dto: MarkReadDto): Promise<void> {
    await this.conversationsService.markAsRead(
      accountId,
      dto.conversationId,
      dto.messageId,
    );
  }

  async reactMessage(
    accountId: string,
    dto: ReactMessageDto,
  ): Promise<MessageResponseDto> {
    await this.assertParticipant(accountId, dto.conversationId);

    const message = await this.messagesService.toggleReaction(
      dto.messageId,
      accountId,
      dto.emoji,
    );

    if (!message) {
      throw new WsException('Message not found');
    }

    return message;
  }

  /**
   * Broadcast the caller's presence status to all their contacts:
   * both friends and fellow conversation participants.
   * Batches the friend lookup to avoid excessively large DB queries.
   */
  async broadcastPresenceToContacts(
    accountId: string,
    status: PresenceStatus,
  ): Promise<void> {
    try {
      const payload = {
        userId: accountId, // included for frontend backwards-compatibility
        accountId,
        status,
        timestamp: new Date().toISOString(),
      };
      const targetIds = new Set<string>();

      // Batch-load friends to avoid one large query
      let skip = 0;
      while (true) {
        const friendIds = await this.friendsService.getFriendIdsBatch(
          accountId,
          skip,
          PRESENCE_BROADCAST_BATCH_SIZE,
        );
        if (friendIds.length === 0) break;
        friendIds.forEach((id) => targetIds.add(id));
        if (friendIds.length < PRESENCE_BROADCAST_BATCH_SIZE) break;
        skip += PRESENCE_BROADCAST_BATCH_SIZE;
      }

      // Also include conversation participants who may not be friends
      const sharedConversations = await this.prisma.conversation.findMany({
        where: {
          participants: { some: { accountId } },
          deletedAt: null,
        },
        select: { participants: { select: { accountId: true } } },
      });

      sharedConversations.forEach((conv) => {
        conv.participants.forEach((p) => {
          if (p.accountId !== accountId) targetIds.add(p.accountId);
        });
      });

      // Emit presence status to every relevant account room
      targetIds.forEach((targetId) => {
        this.socketEmitterService.emitToUser(
          targetId,
          'presence:status',
          payload,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to broadcast presence for account ${accountId}:`,
        error,
      );
    }
  }

  async getUserConversations(
    accountId: string,
  ): Promise<CursorPaginatedResponse<ConversationListItemDto>> {
    return await this.conversationsService.getUserConversations(
      accountId,
      MAX_CONVERSATIONS_TO_REJOIN,
      undefined,
    );
  }

  async pinMessage(
    accountId: string,
    dto: PinMessageDto,
  ): Promise<MessageResponseDto> {
    await this.assertParticipant(accountId, dto.conversationId);

    const pinned = await this.messagesService.pinMessage(
      dto.messageId,
      accountId,
    );
    if (!pinned) throw new WsException('Message not found');

    return pinned;
  }

  async unpinMessage(
    accountId: string,
    dto: PinMessageDto,
  ): Promise<MessageResponseDto> {
    await this.assertParticipant(accountId, dto.conversationId);

    const unpinned = await this.messagesService.unpinMessage(dto.messageId);
    if (!unpinned) throw new WsException('Message not found');

    return unpinned;
  }

  private async assertParticipant(
    accountId: string,
    conversationId: string,
  ): Promise<void> {
    const isParticipant = await this.conversationsService.isParticipant(
      accountId,
      conversationId,
    );
    if (!isParticipant) {
      throw new WsException(
        'Permission denied: you are not a member of this conversation',
      );
    }
  }
}
