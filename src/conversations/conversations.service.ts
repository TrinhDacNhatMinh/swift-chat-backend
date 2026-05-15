import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async createConversation(creatorId: string, dto: CreateConversationDto) {
    if (dto.type === ConversationType.DIRECT) {
      if (!dto.partnerId) {
        throw new BadRequestException('partnerId is required for direct chat');
      }
      if (creatorId === dto.partnerId) {
        throw new BadRequestException('You cannot create a conversation with yourself');
      }
      return this.createOrGetDirectConversation(creatorId, dto.partnerId);
    }

    if (dto.type === ConversationType.GROUP) {
      if (!dto.memberIds || dto.memberIds.length === 0) {
        throw new BadRequestException('memberIds array is required for group chat');
      }
      return this.createGroupConversation(creatorId, dto.memberIds, dto.title);
    }
  }

  private async createOrGetDirectConversation(userId: string, partnerId: string) {
    // Verify partner exists
    const partner = await this.prisma.user.findUnique({ where: { id: partnerId } });
    if (!partner) {
      throw new NotFoundException('Partner user not found');
    }

    // Find existing direct conversation where both users are participants
    const existingParticipant = await this.prisma.participant.findFirst({
      where: {
        userId,
        conversation: {
          type: ConversationType.DIRECT,
          participants: {
            some: { userId: partnerId },
          },
        },
      },
      include: {
        conversation: {
          include: {
            participants: {
              include: {
                user: {
                  select: { id: true, username: true, avatarUrl: true },
                },
              },
            },
          },
        },
      },
    });

    if (existingParticipant) {
      return existingParticipant.conversation;
    }

    // Create new direct conversation with both participants
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: { type: ConversationType.DIRECT },
      });

      await tx.participant.createMany({
        data: [
          { conversationId: conversation.id, userId, role: ParticipantRole.MEMBER },
          { conversationId: conversation.id, userId: partnerId, role: ParticipantRole.MEMBER },
        ],
      });

      return tx.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, username: true, avatarUrl: true },
              },
            },
          },
        },
      });
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

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          type: ConversationType.GROUP,
          title: title || 'New Group',
        },
      });

      const participantRecords = [
        { conversationId: conversation.id, userId: creatorId, role: ParticipantRole.ADMIN },
        ...distinctMemberIds.map((uid) => ({
          conversationId: conversation.id,
          userId: uid,
          role: ParticipantRole.MEMBER,
        })),
      ];

      await tx.participant.createMany({ data: participantRecords });

      return tx.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, username: true, avatarUrl: true },
              },
            },
          },
        },
      });
    });
  }

  async getUserConversations(userId: string, limit: number = 20, offset: number = 0) {
    // Single JOIN query — avoids fetching a large ID array into Node.js memory first
    const participantFilter = { participants: { some: { userId } } };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: participantFilter,
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, username: true, avatarUrl: true, lastSeen: true },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.conversation.count({ where: participantFilter }),
    ]);

    return { data: conversations, total, limit, offset };
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

  async isParticipant(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.prisma.participant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    });
    return !!participant;
  }

  async markAsRead(userId: string, conversationId: string, messageId: string) {
    return this.prisma.participant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { lastReadMessageId: messageId },
    });
  }

  async getReadReceipts(conversationId: string) {
    return this.prisma.participant.findMany({
      where: { conversationId },
      select: {
        userId: true,
        lastReadMessageId: true,
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });
  }
}
