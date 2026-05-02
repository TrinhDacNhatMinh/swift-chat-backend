import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { UpdateGroupDto } from './dto/update-group.dto';
import { Conversation } from '@prisma/client';
import {
  AddMembersResponseDto,
  KickMemberResponseDto,
  DisbandGroupResponseDto,
  TransferLeadershipResponseDto,
  UpdateMemberRoleResponseDto,
} from './dto/conversation-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';

@Injectable()
export class GroupMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketEmitterService: SocketEmitterService,
  ) {}

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  /**
   * Verify that a conversation exists, is a GROUP type, and has not been disbanded.
   * Throws appropriate HTTP exceptions if any check fails.
   */
  async ensureGroupConversation(conversationId: string): Promise<void> {
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

  async getParticipantRole(
    accountId: string,
    conversationId: string,
  ): Promise<ParticipantRole | null> {
    const participant = await this.prisma.participant.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } },
    });
    return (participant?.role as unknown as ParticipantRole) || null;
  }

  // ─── Group Info ─────────────────────────────────────────────────────────────

  async updateGroupInfo(
    actorId: string,
    conversationId: string,
    dto: UpdateGroupDto,
  ): Promise<Conversation> {
    await this.ensureGroupConversation(conversationId);
    const role = await this.getParticipantRole(actorId, conversationId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { title: dto.title, avatarUrl: dto.avatarUrl },
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:info_updated',
      {
        conversationId,
        title: conversation.title,
        avatarUrl: conversation.avatarUrl,
        updatedBy: actorId,
      },
    );

    return conversation;
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  async addMembers(
    actorId: string,
    conversationId: string,
    userIds: string[],
  ): Promise<AddMembersResponseDto> {
    await this.ensureGroupConversation(conversationId);
    const role = await this.getParticipantRole(actorId, conversationId);
    if (!role) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // Skip users who are already in the conversation
    const distinctIds = Array.from(new Set(userIds));
    const existing = await this.prisma.participant.findMany({
      where: { conversationId, accountId: { in: distinctIds } },
      select: { accountId: true },
    });
    const existingIds = existing.map((e) => e.accountId);
    const newIds = distinctIds.filter((id) => !existingIds.includes(id));

    if (newIds.length === 0) return { success: true, added: 0 };

    // Validate all user IDs exist to prevent FK constraint leaks to the client
    const validAccounts = await this.prisma.account.findMany({
      where: { id: { in: newIds } },
      select: { id: true },
    });
    if (validAccounts.length !== newIds.length) {
      const validIds = new Set(validAccounts.map((a) => a.id));
      const invalid = newIds.filter((id) => !validIds.has(id));
      throw new BadRequestException(
        `The following user IDs do not exist: ${invalid.join(', ')}`,
      );
    }

    await this.prisma.participant.createMany({
      data: newIds.map((accountId) => ({
        conversationId,
        accountId,
        role: ParticipantRole.MEMBER,
      })),
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:member_added',
      { conversationId, addedUserIds: newIds, addedBy: actorId },
    );
    newIds.forEach((id) => {
      this.socketEmitterService.emitToUser(id, 'group:you_added', {
        conversationId,
        addedBy: actorId,
      });
    });

    return { success: true, added: newIds.length, userIds: newIds };
  }

  async kickMember(
    actorId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<KickMemberResponseDto> {
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

    // Deputies can only kick regular members, not other deputies or the leader
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
        conversationId_accountId: { conversationId, accountId: targetUserId },
      },
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:member_removed',
      { conversationId, removedUserId: targetUserId, removedBy: actorId },
    );

    return { success: true, removedUserId: targetUserId };
  }

  async leaveGroup(
    actorId: string,
    conversationId: string,
  ): Promise<SuccessResponseDto> {
    await this.ensureGroupConversation(conversationId);

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (!actorRole)
      throw new ForbiddenException('You are not a member of this conversation');

    // Leader must resolve group ownership before leaving
    if (actorRole === ParticipantRole.LEADER) {
      const otherMembersCount = await this.prisma.participant.count({
        where: { conversationId, accountId: { not: actorId } },
      });
      if (otherMembersCount > 0) {
        throw new BadRequestException(
          'You are the leader and the group still has members. ' +
            'Transfer leadership via PATCH /conversations/:id/transfer-leadership, ' +
            'or disband the group via DELETE /conversations/:id.',
        );
      }
    }

    await this.prisma.participant.delete({
      where: {
        conversationId_accountId: { conversationId, accountId: actorId },
      },
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:member_removed',
      { conversationId, removedUserId: actorId, removedBy: actorId },
    );

    return { success: true };
  }

  async disbandGroup(
    actorId: string,
    conversationId: string,
  ): Promise<DisbandGroupResponseDto> {
    await this.ensureGroupConversation(conversationId);

    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (actorRole !== ParticipantRole.LEADER) {
      throw new ForbiddenException('Only the leader can disband the group');
    }

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:disbanded',
      { conversationId, disbandedBy: actorId },
    );

    return { success: true, disbanded: true };
  }

  async transferLeadership(
    actorId: string,
    conversationId: string,
    newLeaderId: string,
  ): Promise<TransferLeadershipResponseDto> {
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
        'Target account is not a member of this conversation',
      );

    // Atomic swap: demote current leader to member, promote target to leader
    await this.prisma.$transaction([
      this.prisma.participant.update({
        where: {
          conversationId_accountId: { conversationId, accountId: actorId },
        },
        data: { role: ParticipantRole.MEMBER },
      }),
      this.prisma.participant.update({
        where: {
          conversationId_accountId: { conversationId, accountId: newLeaderId },
        },
        data: { role: ParticipantRole.LEADER },
      }),
    ]);

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:role_changed',
      {
        conversationId,
        targetUserId: newLeaderId,
        newRole: ParticipantRole.LEADER,
        changedBy: actorId,
      },
    );

    return { success: true, newLeaderId };
  }

  async updateMemberRole(
    actorId: string,
    conversationId: string,
    targetUserId: string,
    newRole: ParticipantRole,
  ): Promise<UpdateMemberRoleResponseDto> {
    await this.ensureGroupConversation(conversationId);
    const actorRole = await this.getParticipantRole(actorId, conversationId);
    if (actorRole !== ParticipantRole.LEADER) {
      throw new ForbiddenException('Only the leader can change roles');
    }

    // Prevent assigning leader via this endpoint — use the dedicated transfer-leadership route instead
    if (newRole === ParticipantRole.LEADER) {
      throw new BadRequestException(
        'Cannot assign leader role directly. Use PATCH /conversations/:id/transfer-leadership instead.',
      );
    }

    const targetRole = await this.getParticipantRole(
      targetUserId,
      conversationId,
    );
    if (!targetRole)
      throw new NotFoundException(
        'Target account is not a member of this conversation',
      );

    await this.prisma.participant.update({
      where: {
        conversationId_accountId: { conversationId, accountId: targetUserId },
      },
      data: { role: newRole },
    });

    this.socketEmitterService.emitToRoom(
      `conversation:${conversationId}`,
      'group:role_changed',
      { conversationId, targetUserId, newRole, changedBy: actorId },
    );

    return { success: true, targetUserId, newRole };
  }
}
