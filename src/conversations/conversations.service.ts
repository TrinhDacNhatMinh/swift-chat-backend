import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { Participant, Profile, Prisma } from '@prisma/client';
import { MessageResponseDto } from '../messages/dto/message-response.dto';
import { MessagesService } from '../messages/messages.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Redis } from 'ioredis';
import {
  HideConversationResponseDto,
  ReadReceiptItemDto,
  ConversationWithParticipantsDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { CursorPaginatedResponse } from '../common/types/response.types';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { BlockService } from '../block/block.service';
import {
  mapParticipants,
  mapToListItem,
  RawParticipant,
  RawConversationListItem,
} from './conversation-list.helpers';

const PARTICIPANT_WITH_PROFILE_INCLUDE = {
  account: {
    select: {
      id: true,
      lastSeen: true,
      profile: {
        select: { displayName: true, avatarUrl: true, handle: true },
      },
    },
  },
} as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly socketEmitterService: SocketEmitterService,
    private readonly blockService: BlockService,
  ) {}

  async createConversation(
    creatorId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationWithParticipantsDto> {
    if (dto.type === ConversationType.DIRECT) {
      if (!dto.partnerId) {
        throw new BadRequestException('partnerId is required for direct chat');
      }
      if (creatorId === dto.partnerId) {
        throw new BadRequestException(
          'You cannot create a conversation with yourself',
        );
      }
      return await this.createOrGetDirectConversation(creatorId, dto.partnerId);
    }

    if (dto.type === ConversationType.GROUP) {
      if (!dto.memberIds || dto.memberIds.length === 0) {
        throw new BadRequestException(
          'memberIds array is required for group chat',
        );
      }
      return await this.createGroupConversation(
        creatorId,
        dto.memberIds,
        dto.title,
      );
    }
    throw new BadRequestException('Invalid conversation type');
  }

  private async createOrGetDirectConversation(
    accountId: string,
    partnerId: string,
  ) {
    // Confirm the partner account exists before creating the conversation
    const partner = await this.prisma.account.findUnique({
      where: { id: partnerId },
    });
    if (!partner) {
      throw new NotFoundException('Partner account not found');
    }

    // Prevent conversation creation if either party has blocked the other
    const isBlocked = await this.blockService.isBlockedEitherDirection(
      accountId,
      partnerId,
    );
    if (isBlocked) {
      throw new ForbiddenException(
        'Cannot start a conversation with this user',
      );
    }

    // Find an existing direct conversation where both accounts are participants
    const existingParticipant = await this.prisma.participant.findFirst({
      where: {
        accountId,
        conversation: {
          type: ConversationType.DIRECT,
          participants: {
            some: { accountId: partnerId },
          },
        },
      },
      include: {
        conversation: {
          include: {
            participants: {
              include: PARTICIPANT_WITH_PROFILE_INCLUDE,
            },
          },
        },
      },
    });

    if (existingParticipant) {
      // If the caller had hidden this conversation, unhide it.
      // We also bump the conversation's updatedAt so it bubbles to the top of the list.
      await this.prisma.$transaction([
        this.prisma.participant.update({
          where: { id: existingParticipant.id },
          data: { hiddenAt: null },
        }),
        this.prisma.conversation.update({
          where: { id: existingParticipant.conversation.id },
          data: { updatedAt: new Date() },
        })
      ]);

      return {
        ...existingParticipant.conversation,
        participants: this.mapParticipants(
          existingParticipant.conversation.participants,
        ),
      };
    }

    // Create new direct conversation with both participants
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: { type: ConversationType.DIRECT },
      });

      await tx.participant.createMany({
        data: [
          {
            conversationId: conversation.id,
            accountId,
            role: ParticipantRole.MEMBER,
          },
          {
            conversationId: conversation.id,
            accountId: partnerId,
            role: ParticipantRole.MEMBER,
          },
        ],
      });

      const newConversation = await tx.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: PARTICIPANT_WITH_PROFILE_INCLUDE,
          },
        },
      });
      return {
        ...newConversation,
        participants: this.mapParticipants(newConversation!.participants),
      } as ConversationWithParticipantsDto;
    });
  }

  private async createGroupConversation(
    creatorId: string,
    rawMemberIds: string[],
    title?: string,
  ) {
    // Deduplicate and remove creator from the list to avoid constraint violation
    const distinctMemberIds = Array.from(new Set(rawMemberIds)).filter(
      (id) => id !== creatorId,
    );

    return await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          type: ConversationType.GROUP,
          title: title || 'New Group',
        },
      });

      const participantRecords = [
        {
          conversationId: conversation.id,
          accountId: creatorId,
          role: ParticipantRole.LEADER,
        },
        ...distinctMemberIds.map((uid) => ({
          conversationId: conversation.id,
          accountId: uid,
          role: ParticipantRole.MEMBER,
        })),
      ];

      await tx.participant.createMany({ data: participantRecords });

      const newConversation = await tx.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: PARTICIPANT_WITH_PROFILE_INCLUDE,
          },
        },
      });
      return {
        ...newConversation,
        participants: this.mapParticipants(newConversation!.participants),
      } as ConversationWithParticipantsDto;
    });
  }

  async getParticipantRole(
    accountId: string,
    conversationId: string,
  ): Promise<ParticipantRole | null> {
    const participant = await this.prisma.participant.findUnique({
      where: {
        conversationId_accountId: { conversationId, accountId },
      },
    });
    return (participant?.role as unknown as ParticipantRole) || null;
  }

  async getUserConversations(
    accountId: string,
    limit: number = 20,
    cursor?: string,
    q: string = '',
  ): Promise<CursorPaginatedResponse<ConversationListItemDto>> {
    const rawPage = await this.fetchConversationPage(
      accountId,
      limit,
      cursor,
      q,
    );
    const hasMore = rawPage.length > limit;
    const conversations = hasMore ? rawPage.slice(0, limit) : rawPage;

    const [onlineUserIds, myParticipantMap, unreadCounts, lastMessagesMap] =
      await Promise.all([
        this.getOnlineUserIds(conversations, accountId),
        this.getMyParticipants(conversations, accountId),
        this.getUnreadCounts(conversations, accountId),
        this.messagesService.getLastMessagesForConversations(
          accountId,
          conversations.map((c) => c.id),
        ),
      ]);

    // Fetch sender profiles for last-message preview (sequential: needs lastMessagesMap first)
    const senderIds = Array.from(
      new Set(Array.from(lastMessagesMap.values()).map((m) => m.senderId)),
    );
    const senderProfiles = await this.prisma.profile.findMany({
      where: { accountId: { in: senderIds } },
    });
    const senderProfileMap = new Map(
      senderProfiles.map((p) => [p.accountId, p]),
    );

    const data = conversations.map((conv) =>
      this.mapToListItem(
        conv,
        myParticipantMap.get(conv.id),
        onlineUserIds,
        unreadCounts,
        lastMessagesMap,
        senderProfileMap,
      ),
    );

    return {
      data,
      nextCursor: hasMore
        ? conversations[conversations.length - 1].updatedAt.toISOString()
        : null,
      hasMore,
    };
  }

  private async fetchConversationPage(
    accountId: string,
    limit: number,
    cursor?: string,
    q?: string,
  ): Promise<RawConversationListItem[]> {
    const where: Prisma.ConversationWhereInput = {
      participants: { some: { accountId, hiddenAt: null } },
      deletedAt: null,
    };
    if (cursor) where.updatedAt = { lt: new Date(cursor) };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        {
          participants: {
            some: {
              account: {
                OR: [
                  { username: { contains: q, mode: 'insensitive' } },
                  {
                    profile: {
                      displayName: { contains: q, mode: 'insensitive' },
                    },
                  },
                ],
              },
            },
          },
        },
      ];
    }
    return this.prisma.conversation.findMany({
      where,
      include: {
        participants: {
          where: { accountId: { not: accountId } },
          take: 3,
          include: PARTICIPANT_WITH_PROFILE_INCLUDE,
        },
        _count: { select: { participants: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit + 1,
    });
  }

  /** Resolve which participant IDs are currently online via Redis presence keys. */
  private async getOnlineUserIds(
    conversations: RawConversationListItem[],
    accountId: string,
  ): Promise<Set<string>> {
    const uniqueUserIds = Array.from(
      new Set(
        conversations.flatMap((c) =>
          c.participants
            .filter((p) => p.accountId !== accountId)
            .map((p) => p.accountId),
        ),
      ),
    );

    const onlineUserIds = new Set<string>();
    if (uniqueUserIds.length > 0) {
      const statuses = await this.redis.mget(
        uniqueUserIds.map((id) => `presence:${id}`),
      );
      statuses.forEach((s, i) => {
        if (s === 'online') onlineUserIds.add(uniqueUserIds[i]);
      });
    }
    return onlineUserIds;
  }

  /** Fetch the caller's own participant records and build a conversationId → Participant map. */
  private async getMyParticipants(
    conversations: RawConversationListItem[],
    accountId: string,
  ): Promise<Map<string, Participant>> {
    const myParticipants = await this.prisma.participant.findMany({
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        accountId,
      },
    });
    return new Map(myParticipants.map((p) => [p.conversationId, p]));
  }

  /**
   * Count unread messages for each conversation in the page.
   * Requires a separate call to getMyParticipants first to get lastReadMessageId;
   * this helper fetches its own participant data to remain self-contained.
   */
  private async getUnreadCounts(
    conversations: RawConversationListItem[],
    accountId: string,
  ): Promise<Map<string, number>> {
    const myParticipants = await this.prisma.participant.findMany({
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        accountId,
      },
      select: { conversationId: true, lastReadMessageId: true },
    });
    const lastReadMap = new Map<string, string | null>(
      myParticipants.map((p) => [p.conversationId, p.lastReadMessageId]),
    );
    // Initialise all to 0 for conversations missing from the map
    conversations.forEach((c) => {
      if (!lastReadMap.has(c.id)) lastReadMap.set(c.id, null);
    });
    return this.messagesService.countUnreadInConversations(
      accountId,
      lastReadMap,
    );
  }

  private mapToListItem(
    conv: RawConversationListItem,
    myParticipant: Participant | undefined,
    onlineUserIds: Set<string>,
    unreadCounts: Map<string, number>,
    lastMessagesMap: Map<string, MessageResponseDto>,
    senderProfileMap: Map<string, Profile>,
  ): ConversationListItemDto {
    return mapToListItem(
      conv,
      myParticipant,
      onlineUserIds,
      unreadCounts,
      lastMessagesMap,
      senderProfileMap,
    );
  }

  /**
   * Smart dispatcher for DELETE /conversations/:id.
   * - Group  → disbandGroup() (soft-delete, Leader only)
   * - Direct → hideDirectConversation() (sets hiddenAt for caller only)
   */
  async getConversationType(conversationId: string): Promise<string> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation.type;
  }

  async hideDirectConversation(
    accountId: string,
    conversationId: string,
  ): Promise<HideConversationResponseDto> {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    await this.prisma.participant.update({
      where: { conversationId_accountId: { conversationId, accountId } },
      data: { hiddenAt: new Date() },
    });

    return { success: true, hidden: true };
  }

  /**
   * Called when a new message arrives in a direct conversation.
   * Re-shows the conversation for participants who had hidden it.
   */
  async resetHiddenAt(conversationId: string): Promise<void> {
    await this.prisma.participant.updateMany({
      where: {
        conversationId,
        hiddenAt: { not: null },
      },
      data: { hiddenAt: null },
    });
  }

  async conversationExists(conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    return !!conversation;
  }
  async updateTimestamp(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }

  async isParticipant(
    accountId: string,
    conversationId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.participant.findUnique({
      where: {
        conversationId_accountId: {
          conversationId,
          accountId,
        },
      },
    });
    return !!participant;
  }

  async markAsRead(
    accountId: string,
    conversationId: string,
    messageId: string,
  ): Promise<Participant> {
    return await this.prisma.participant.update({
      where: {
        conversationId_accountId: { conversationId, accountId },
      },
      data: { lastReadMessageId: messageId },
    });
  }

  async getReadReceipts(
    accountId: string,
    conversationId: string,
  ): Promise<ReadReceiptItemDto[]> {
    const isMember = await this.isParticipant(accountId, conversationId);
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    return await this.prisma.participant.findMany({
      where: { conversationId },
      select: {
        accountId: true,
        lastReadMessageId: true,
        account: {
          select: {
            id: true,
            lastSeen: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
                handle: true,
              },
            },
          },
        },
      },
    });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async getMembers(accountId: string, conversationId: string) {
    const isMember = await this.isParticipant(accountId, conversationId);
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    const participants = await this.prisma.participant.findMany({
      where: { conversationId },
      select: {
        id: true,
        accountId: true,
        role: true,
        joinAt: true,
        account: {
          select: {
            profile: {
              select: {
                handle: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { joinAt: 'asc' },
    });

    return participants.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      role: p.role,
      joinAt: p.joinAt,
      handle: p.account.profile?.handle || '',
      displayName: p.account.profile?.displayName || null,
      avatarUrl: p.account.profile?.avatarUrl || null,
    }));
  }

  // ─── Mute ─────────────────────────────────────────────────────────────────────

  /**
   * Mute a conversation for the specified duration.
   * Duration values: `1h`, `8h`, `24h`, or `forever` (year 9999).
   * Prevents push notifications from being sent while muted.
   */
  async muteConversation(
    accountId: string,
    conversationId: string,
    duration: '1h' | '8h' | '24h' | 'forever',
  ): Promise<{ success: boolean; mutedUntil: Date | null }> {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    let mutedUntil: Date;
    const now = new Date();

    switch (duration) {
      case '1h':
        mutedUntil = new Date(now.getTime() + 1 * 60 * 60 * 1000);
        break;
      case '8h':
        mutedUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        break;
      case '24h':
        mutedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'forever':
      default:
        // Use year 9999 to represent indefinite mute
        mutedUntil = new Date('9999-01-01T00:00:00.000Z');
        break;
    }

    await this.prisma.participant.update({
      where: { conversationId_accountId: { conversationId, accountId } },
      data: { mutedUntil },
    });

    return { success: true, mutedUntil };
  }

  async unmuteConversation(
    accountId: string,
    conversationId: string,
  ): Promise<{ success: boolean }> {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    await this.prisma.participant.update({
      where: { conversationId_accountId: { conversationId, accountId } },
      data: { mutedUntil: null },
    });

    return { success: true };
  }

  /**
   * Check if a participant has muted a conversation.
   * Used by FCM service before sending push notifications.
   */
  async isConversationMuted(
    accountId: string,
    conversationId: string,
  ): Promise<boolean> {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } },
      select: { mutedUntil: true },
    });

    if (!participant || participant.mutedUntil === null) return false;

    return participant.mutedUntil > new Date();
  }

  async getUserConversationIds(accountId: string): Promise<string[]> {
    const participants = await this.prisma.participant.findMany({
      where: {
        accountId,
        hiddenAt: null,
        conversation: { deletedAt: null },
      },
      select: { conversationId: true },
    });
    return participants.map((p) => p.conversationId);
  }

  private mapParticipants(participants: RawParticipant[]) {
    return mapParticipants(participants);
  }
}
