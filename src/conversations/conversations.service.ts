import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Server } from 'socket.io';

@Injectable()
export class ConversationsService {
  private server: Server;

  constructor(private prisma: PrismaService) {}

  setServer(server: Server) {
    this.server = server;
  }

  async createConversation(creatorId: string, dto: CreateConversationDto) {
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
      return await this.createGroupConversation(creatorId, dto.memberIds, dto.title);
    }
  }

  private async createOrGetDirectConversation(
    userId: string,
    partnerId: string,
  ) {
    // Verify partner exists
    const partner = await this.prisma.user.findUnique({
      where: { id: partnerId },
    });
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
          {
            conversationId: conversation.id,
            userId,
            role: ParticipantRole.MEMBER,
          },
          {
            conversationId: conversation.id,
            userId: partnerId,
            role: ParticipantRole.MEMBER,
          },
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
          userId: creatorId,
          role: ParticipantRole.LEADER,
        },
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

  async getParticipantRole(
    userId: string,
    conversationId: string,
  ): Promise<ParticipantRole | null> {
    const participant = await this.prisma.participant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId },
      },
    });
    return (participant?.role as unknown as ParticipantRole) || null;
  }

  private async ensureGroupConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true, deletedAt: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.deletedAt)
      throw new BadRequestException('This group has been disbanded');
    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException(
        'This feature is only supported for group chats',
      );
    }
  }

  async updateGroupInfo(
    actorId: string,
    conversationId: string,
    dto: UpdateGroupDto,
  ) {
    await this.ensureGroupConversation(conversationId);
    const role = await this.getParticipantRole(actorId, conversationId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: dto.title,
        avatarUrl: dto.avatarUrl,
      },
    });

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:info_updated', {
          conversationId,
          title: conversation.title,
          avatarUrl: conversation.avatarUrl,
          updatedBy: actorId,
        });
    }

    return conversation;
  }

  async addMembers(actorId: string, conversationId: string, userIds: string[]) {
    await this.ensureGroupConversation(conversationId);
    const role = await this.getParticipantRole(actorId, conversationId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // Deduplicate and filter out already existing participants
    const distinctIds = Array.from(new Set(userIds));
    const existing = await this.prisma.participant.findMany({
      where: {
        conversationId,
        userId: { in: distinctIds },
      },
      select: { userId: true },
    });
    const existingIds = existing.map((e) => e.userId);
    const newIds = distinctIds.filter((id) => !existingIds.includes(id));

    if (newIds.length === 0) return { success: true, added: 0 };

    await this.prisma.participant.createMany({
      data: newIds.map((userId) => ({
        conversationId,
        userId,
        role: ParticipantRole.MEMBER,
      })),
    });

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:member_added', {
          conversationId,
          addedUserIds: newIds,
          addedBy: actorId,
        });
      // Notify new members to join the room on client side
      newIds.forEach((id) => {
        this.server.to(`user:${id}`).emit('group:you_added', {
          conversationId,
          addedBy: actorId,
        });
      });
    }

    return { success: true, added: newIds.length, userIds: newIds };
  }

  async kickMember(
    actorId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    await this.ensureGroupConversation(conversationId);

    if (actorId === targetUserId) {
      throw new BadRequestException(
        'Cannot kick yourself. Use the leave endpoint instead.',
      );
    }

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (!actorRole)
      throw new ForbiddenException('You are not a member of this conversation');

    if (actorRole === ParticipantRole.MEMBER) {
      throw new ForbiddenException('Members cannot remove other users');
    }

    // Deputy can only kick members, not other deputies or the leader
    if (actorRole === ParticipantRole.DEPUTY) {
      const targetRole = await this.getParticipantRole(
        targetUserId,
        conversationId,
      );
      if (targetRole !== ParticipantRole.MEMBER) {
        throw new ForbiddenException('Deputies can only remove members');
      }
    }

    await this.prisma.participant.delete({
      where: {
        conversationId_userId: { conversationId, userId: targetUserId },
      },
    });

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:member_removed', {
          conversationId,
          removedUserId: targetUserId,
          removedBy: actorId,
        });
    }

    return { success: true, removedUserId: targetUserId };
  }

  async leaveGroup(actorId: string, conversationId: string) {
    await this.ensureGroupConversation(conversationId);

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (!actorRole)
      throw new ForbiddenException('You are not a member of this conversation');

    // Leader must resolve group ownership before leaving
    if (actorRole === ParticipantRole.LEADER) {
      const otherMembersCount = await this.prisma.participant.count({
        where: { conversationId, userId: { not: actorId } },
      });
      if (otherMembersCount > 0) {
        throw new BadRequestException(
          'You are the leader and the group still has members. ' +
            'Transfer leadership via POST /conversations/:id/transfer-leadership, ' +
            'or disband the group via DELETE /conversations/:id.',
        );
      }
    }

    await this.prisma.participant.delete({
      where: { conversationId_userId: { conversationId, userId: actorId } },
    });

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:member_removed', {
          conversationId,
          removedUserId: actorId,
          removedBy: actorId,
        });
    }

    return { success: true };
  }

  async disbandGroup(actorId: string, conversationId: string) {
    await this.ensureGroupConversation(conversationId);

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (actorRole !== ParticipantRole.LEADER) {
      throw new ForbiddenException('Only the leader can disband the group');
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });

    if (this.server) {
      this.server.to(`conversation:${conversationId}`).emit('group:disbanded', {
        conversationId,
        disbandedBy: actorId,
      });
    }

    return { success: true, disbanded: true };
  }

  async transferLeadership(
    actorId: string,
    conversationId: string,
    newLeaderId: string,
  ) {
    await this.ensureGroupConversation(conversationId);

    if (actorId === newLeaderId) {
      throw new BadRequestException('You are already the leader');
    }

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (actorRole !== ParticipantRole.LEADER) {
      throw new ForbiddenException('Only the leader can transfer leadership');
    }

    const targetRole = await this.getParticipantRole(
      newLeaderId,
      conversationId,
    );
    if (!targetRole)
      throw new NotFoundException(
        'Target user is not a member of this conversation',
      );

    // Atomic swap: demote current leader → member, promote target → leader
    await this.prisma.$transaction([
      this.prisma.participant.update({
        where: { conversationId_userId: { conversationId, userId: actorId } },
        data: { role: ParticipantRole.MEMBER },
      }),
      this.prisma.participant.update({
        where: {
          conversationId_userId: { conversationId, userId: newLeaderId },
        },
        data: { role: ParticipantRole.LEADER },
      }),
    ]);

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:role_changed', {
          conversationId,
          targetUserId: newLeaderId,
          newRole: ParticipantRole.LEADER,
          changedBy: actorId,
        });
    }

    return { success: true, newLeaderId };
  }

  async updateMemberRole(
    actorId: string,
    conversationId: string,
    targetUserId: string,
    newRole: ParticipantRole,
  ) {
    await this.ensureGroupConversation(conversationId);
    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (actorRole !== ParticipantRole.LEADER) {
      throw new ForbiddenException('Only the leader can change roles');
    }

    // Cannot assign leader role via this method — use POST /conversations/:id/transfer-leadership instead
    if (newRole === ParticipantRole.LEADER) {
      throw new BadRequestException(
        'Cannot assign leader role directly. Use POST /conversations/:id/transfer-leadership instead.',
      );
    }

    const targetRole = await this.getParticipantRole(
      targetUserId,
      conversationId,
    );
    if (!targetRole)
      throw new NotFoundException(
        'Target user is not a member of this conversation',
      );

    await this.prisma.participant.update({
      where: {
        conversationId_userId: { conversationId, userId: targetUserId },
      },
      data: { role: newRole },
    });

    if (this.server) {
      this.server
        .to(`conversation:${conversationId}`)
        .emit('group:role_changed', {
          conversationId,
          targetUserId,
          newRole,
          changedBy: actorId,
        });
    }

    return { success: true, targetUserId, newRole };
  }

  async getUserConversations(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ) {
    // Filter: conversation is not disbanded AND the user's participant record is not hidden
    const participantFilter = {
      participants: {
        some: {
          userId,
          hiddenAt: null, // exclude conversations the user has hidden
        },
      },
      deletedAt: null, // exclude disbanded groups
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: participantFilter,
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  avatarUrl: true,
                  lastSeen: true,
                },
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

  /**
   * Smart dispatcher for DELETE /conversations/:id.
   * - Group  → disbandGroup() (soft-delete, Leader only)
   * - Direct → hideDirectConversation() (sets hiddenAt for caller only)
   */
  async deleteConversation(actorId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.type === ConversationType.GROUP) {
      return this.disbandGroup(actorId, conversationId);
    }

    // Direct conversation: hide for the caller only
    return this.hideDirectConversation(actorId, conversationId);
  }

  async hideDirectConversation(userId: string, conversationId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    await this.prisma.participant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { hiddenAt: new Date() },
    });

    return { success: true, hidden: true };
  }

  /**
   * Called when a new message arrives in a direct conversation.
   * Re-shows the conversation for participants who had hidden it.
   */
  async resetHiddenAt(conversationId: string) {
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
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
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
    return await this.prisma.participant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: { lastReadMessageId: messageId },
    });
  }

  async getReadReceipts(conversationId: string) {
    return await this.prisma.participant.findMany({
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
