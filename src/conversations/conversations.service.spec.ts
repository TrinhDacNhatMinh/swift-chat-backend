import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { createMockPrismaService } from '../__mocks__/prisma.mock';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // createConversation()
  // =========================================================================
  describe('createConversation()', () => {
    it('should throw when DIRECT without partnerId', async () => {
      await expect(
        service.createConversation('u1', { type: ConversationType.DIRECT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when DIRECT with self', async () => {
      await expect(
        service.createConversation('u1', {
          type: ConversationType.DIRECT,
          partnerId: 'u1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when GROUP without memberIds', async () => {
      await expect(
        service.createConversation('u1', { type: ConversationType.GROUP }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when GROUP with empty memberIds', async () => {
      await expect(
        service.createConversation('u1', {
          type: ConversationType.GROUP,
          memberIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // createOrGetDirectConversation (indirect via createConversation)
  // =========================================================================
  describe('DIRECT conversation', () => {
    it('should throw when partner not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.createConversation('u1', {
          type: ConversationType.DIRECT,
          partnerId: 'u2',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing conversation if already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      const existing = { id: 'conv1', type: 'direct', participants: [] };
      prisma.participant.findFirst.mockResolvedValue({
        conversation: existing,
      });

      const result = await service.createConversation('u1', {
        type: ConversationType.DIRECT,
        partnerId: 'u2',
      });

      expect(result).toEqual(existing);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create new conversation with two participants', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.participant.findFirst.mockResolvedValue(null);
      const newConv = { id: 'conv-new', type: 'direct', participants: [] };
      prisma.conversation.create.mockResolvedValue(newConv);
      prisma.participant.createMany.mockResolvedValue({ count: 2 });
      prisma.conversation.findUnique.mockResolvedValue(newConv);

      const result = await service.createConversation('u1', {
        type: ConversationType.DIRECT,
        partnerId: 'u2',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { type: ConversationType.DIRECT } }),
      );
      expect(prisma.participant.createMany).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createGroupConversation (indirect via createConversation)
  // =========================================================================
  describe('GROUP conversation', () => {
    it('should create group with creator as LEADER', async () => {
      const newConv = {
        id: 'g1',
        type: 'group',
        title: 'Test',
        participants: [],
      };
      prisma.conversation.create.mockResolvedValue(newConv);
      prisma.participant.createMany.mockResolvedValue({ count: 3 });
      prisma.conversation.findUnique.mockResolvedValue(newConv);

      await service.createConversation('u1', {
        type: ConversationType.GROUP,
        memberIds: ['u2', 'u3'],
        title: 'Test',
      });

      const createManyCall = prisma.participant.createMany.mock.calls[0][0];
      const records = createManyCall.data;
      // Creator should be ADMIN
      expect(records[0]).toEqual(
        expect.objectContaining({ userId: 'u1', role: ParticipantRole.LEADER }),
      );
      // Others should be MEMBER
      expect(records[1]).toEqual(
        expect.objectContaining({ role: ParticipantRole.MEMBER }),
      );
    });

    it('should deduplicate memberIds and exclude creator', async () => {
      prisma.conversation.create.mockResolvedValue({ id: 'g1' });
      prisma.participant.createMany.mockResolvedValue({ count: 2 });
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'g1',
        participants: [],
      });

      await service.createConversation('u1', {
        type: ConversationType.GROUP,
        memberIds: ['u2', 'u2', 'u1'], // duplicates + creator
      });

      const records = prisma.participant.createMany.mock.calls[0][0].data;
      // Should be: creator(u1) + u2 only (u1 deduplicated, u2 deduplicated)
      expect(records).toHaveLength(2);
    });
  });

  // =========================================================================
  // getUserConversations()
  // =========================================================================
  describe('getUserConversations()', () => {
    it('should return paginated conversations', async () => {
      prisma.conversation.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.conversation.count.mockResolvedValue(1);

      const result = await service.getUserConversations('u1', 20, 0);

      expect(result).toEqual({
        data: [{ id: 'c1' }],
        total: 1,
        limit: 20,
        offset: 0,
      });
    });
  });

  // =========================================================================
  // conversationExists()
  // =========================================================================
  describe('conversationExists()', () => {
    it('should return true when conversation exists', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1' });
      expect(await service.conversationExists('c1')).toBe(true);
    });

    it('should return false when conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      expect(await service.conversationExists('x')).toBe(false);
    });
  });

  // =========================================================================
  // isParticipant()
  // =========================================================================
  describe('isParticipant()', () => {
    it('should return true when user is participant', async () => {
      prisma.participant.findUnique.mockResolvedValue({ id: 'p1' });
      expect(await service.isParticipant('u1', 'c1')).toBe(true);
    });

    it('should return false when user is not participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      expect(await service.isParticipant('u1', 'c1')).toBe(false);
    });
  });

  // =========================================================================
  // markAsRead()
  // =========================================================================
  describe('markAsRead()', () => {
    it('should update lastReadMessageId', async () => {
      prisma.participant.update.mockResolvedValue({});
      await service.markAsRead('u1', 'c1', 'msg1');
      expect(prisma.participant.update).toHaveBeenCalledWith({
        where: {
          conversationId_userId: { conversationId: 'c1', userId: 'u1' },
        },
        data: { lastReadMessageId: 'msg1' },
      });
    });
  });

  // =========================================================================
  // getReadReceipts()
  // =========================================================================
  describe('getReadReceipts()', () => {
    it('should return all participant read receipts', async () => {
      const receipts = [{ userId: 'u1', lastReadMessageId: 'msg1' }];
      prisma.participant.findMany.mockResolvedValue(receipts);

      const result = await service.getReadReceipts('c1');

      expect(prisma.participant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 'c1' } }),
      );
      expect(result).toEqual(receipts);
    });
  // =========================================================================
  // Group Management Features (Leader / Deputy / Member)
  // =========================================================================
  describe('Group Management', () => {
    beforeEach(() => {
      prisma.conversation.findUnique.mockResolvedValue({ type: ConversationType.GROUP, deletedAt: null });
    });

    describe('updateGroupInfo()', () => {
      it('should throw ForbiddenException if user is not a participant', async () => {
        prisma.participant.findUnique.mockResolvedValue(null);
        await expect(service.updateGroupInfo('u1', 'c1', { title: 'New' }))
          .rejects.toThrow('You are not a member of this conversation');
      });

      it('should allow any member to update group info', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.MEMBER });
        prisma.conversation.update.mockResolvedValue({ title: 'New', avatarUrl: 'url' });

        const result = await service.updateGroupInfo('u1', 'c1', { title: 'New' });
        expect(result).toEqual(expect.objectContaining({ title: 'New' }));
      });

      it('should allow deputy to update group info', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.DEPUTY });
        prisma.conversation.update.mockResolvedValue({ title: 'New' });

        const result = await service.updateGroupInfo('u1', 'c1', { title: 'New' });
        expect(result).toEqual(expect.objectContaining({ title: 'New' }));
      });

      it('should allow leader to update group info', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        prisma.conversation.update.mockResolvedValue({ title: 'New' });

        const result = await service.updateGroupInfo('u1', 'c1', { title: 'New' });
        expect(result).toEqual(expect.objectContaining({ title: 'New' }));
      });
    });

    describe('addMembers()', () => {
      it('should throw ForbiddenException if user is not a participant', async () => {
        prisma.participant.findUnique.mockResolvedValue(null);
        await expect(service.addMembers('u1', 'c1', ['u2']))
          .rejects.toThrow('You are not a member of this conversation');
      });

      it('should allow any role to add members', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.MEMBER });
        prisma.participant.findMany.mockResolvedValue([{ userId: 'u2' }]);
        prisma.participant.createMany.mockResolvedValue({ count: 1 });

        const result = await service.addMembers('u1', 'c1', ['u2', 'u3']);
        expect(result.added).toBe(1);
        expect(result.userIds).toEqual(['u3']);
        expect(prisma.participant.createMany).toHaveBeenCalledWith({
          data: [{ conversationId: 'c1', userId: 'u3', role: ParticipantRole.MEMBER }],
        });
      });
    });

    describe('kickMember()', () => {
      it('should throw BadRequestException if actor tries to kick themselves', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        await expect(service.kickMember('u1', 'c1', 'u1'))
          .rejects.toThrow('Cannot kick yourself');
      });

      it('should throw ForbiddenException if actor is not a participant', async () => {
        prisma.participant.findUnique.mockResolvedValue(null);
        await expect(service.kickMember('u1', 'c1', 'u2'))
          .rejects.toThrow('You are not a member of this conversation');
      });

      it('should throw ForbiddenException if actor is a member', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.MEMBER });
        await expect(service.kickMember('u1', 'c1', 'u2'))
          .rejects.toThrow('Members cannot remove other users');
      });

      it('should allow leader to kick anyone', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        prisma.participant.delete.mockResolvedValue({});

        const result = await service.kickMember('u1', 'c1', 'u2');
        expect(result.removedUserId).toBe('u2');
      });

      it('should allow deputy to kick a member', async () => {
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.DEPUTY })
          .mockResolvedValueOnce({ role: ParticipantRole.MEMBER });
        prisma.participant.delete.mockResolvedValue({});

        const result = await service.kickMember('u1', 'c1', 'u2');
        expect(result.removedUserId).toBe('u2');
      });

      it('should NOT allow deputy to kick another deputy', async () => {
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.DEPUTY })
          .mockResolvedValueOnce({ role: ParticipantRole.DEPUTY });

        await expect(service.kickMember('u1', 'c1', 'u2'))
          .rejects.toThrow('Deputies can only remove members');
      });
    });

    describe('leaveGroup()', () => {
      it('should throw ForbiddenException if actor is not a participant', async () => {
        prisma.participant.findUnique.mockResolvedValue(null);
        await expect(service.leaveGroup('u1', 'c1'))
          .rejects.toThrow('You are not a member of this conversation');
      });

      it('should allow a member to leave', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.MEMBER });
        prisma.participant.delete.mockResolvedValue({});

        const result = await service.leaveGroup('u1', 'c1');
        expect(result.success).toBe(true);
        expect(prisma.participant.delete).toHaveBeenCalledWith({
          where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
        });
      });

      it('should allow a deputy to leave', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.DEPUTY });
        prisma.participant.delete.mockResolvedValue({});

        const result = await service.leaveGroup('u1', 'c1');
        expect(result.success).toBe(true);
      });

      it('should throw BadRequestException if leader tries to leave while others exist', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        prisma.participant.count.mockResolvedValue(2);

        await expect(service.leaveGroup('u1', 'c1'))
          .rejects.toThrow('You are the leader and the group still has members');
      });

      it('should allow leader to leave if they are the last member', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        prisma.participant.count.mockResolvedValue(0);
        prisma.participant.delete.mockResolvedValue({});

        const result = await service.leaveGroup('u1', 'c1');
        expect(result.success).toBe(true);
      });
    });

    describe('disbandGroup()', () => {
      it('should throw ForbiddenException if actor is not leader', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.DEPUTY });
        await expect(service.disbandGroup('u1', 'c1'))
          .rejects.toThrow('Only the leader can disband the group');
      });

      it('should soft-delete the conversation if leader disbands', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        prisma.conversation.update.mockResolvedValue({});

        const result = await service.disbandGroup('u1', 'c1');
        expect(result.disbanded).toBe(true);
        expect(prisma.conversation.update).toHaveBeenCalledWith({
          where: { id: 'c1' },
          data: { deletedAt: expect.any(Date) },
        });
      });
    });

    describe('transferLeadership()', () => {
      it('should throw BadRequestException if newLeaderId is the same as actor', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        await expect(service.transferLeadership('u1', 'c1', 'u1'))
          .rejects.toThrow('You are already the leader');
      });

      it('should throw ForbiddenException if actor is not leader', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.MEMBER });
        await expect(service.transferLeadership('u1', 'c1', 'u2'))
          .rejects.toThrow('Only the leader can transfer leadership');
      });

      it('should throw NotFoundException if target is not a member', async () => {
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.LEADER })
          .mockResolvedValueOnce(null);

        await expect(service.transferLeadership('u1', 'c1', 'u2'))
          .rejects.toThrow(NotFoundException);
      });

      it('should atomically swap leader and demote old leader to member', async () => {
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.LEADER })
          .mockResolvedValueOnce({ role: ParticipantRole.MEMBER });
        prisma.$transaction.mockResolvedValue([{}, {}]);

        const result = await service.transferLeadership('u1', 'c1', 'u2');
        expect(result.newLeaderId).toBe('u2');
        expect(prisma.$transaction).toHaveBeenCalled();
      });
    });

    describe('updateMemberRole()', () => {
      it('should throw ForbiddenException if user is not leader', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.DEPUTY });
        await expect(service.updateMemberRole('u1', 'c1', 'u2', ParticipantRole.DEPUTY))
          .rejects.toThrow('Only the leader can change roles');
      });

      it('should throw BadRequestException if trying to assign leader role', async () => {
        prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
        await expect(service.updateMemberRole('u1', 'c1', 'u2', ParticipantRole.LEADER))
          .rejects.toThrow('Cannot assign leader role directly');
      });

      it('should promote member to deputy', async () => {
        // First call: actor role (leader), second call: target role (member)
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.LEADER })
          .mockResolvedValueOnce({ role: ParticipantRole.MEMBER });
        prisma.participant.update.mockResolvedValue({});

        const result = await service.updateMemberRole('u1', 'c1', 'u2', ParticipantRole.DEPUTY);
        expect(result.newRole).toBe(ParticipantRole.DEPUTY);
        expect(prisma.participant.update).toHaveBeenCalledWith({
          where: { conversationId_userId: { conversationId: 'c1', userId: 'u2' } },
          data: { role: ParticipantRole.DEPUTY },
        });
      });

      it('should demote deputy to member', async () => {
        prisma.participant.findUnique
          .mockResolvedValueOnce({ role: ParticipantRole.LEADER })
          .mockResolvedValueOnce({ role: ParticipantRole.DEPUTY });
        prisma.participant.update.mockResolvedValue({});

        const result = await service.updateMemberRole('u1', 'c1', 'u2', ParticipantRole.MEMBER);
        expect(result.newRole).toBe(ParticipantRole.MEMBER);
      });
    });
    });
  });

  // =========================================================================
  // deleteConversation() — smart dispatcher
  // =========================================================================
  describe('deleteConversation()', () => {
    it('should throw NotFoundException if conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      await expect(service.deleteConversation('u1', 'c1'))
        .rejects.toThrow(NotFoundException);
    });

    it('should call disbandGroup() when type is GROUP', async () => {
      prisma.conversation.findUnique
        // First call: type lookup in deleteConversation
        .mockResolvedValueOnce({ type: ConversationType.GROUP })
        // Second call: ensureGroupConversation inside disbandGroup
        .mockResolvedValueOnce({ type: ConversationType.GROUP, deletedAt: null });
      prisma.participant.findUnique.mockResolvedValue({ role: ParticipantRole.LEADER });
      prisma.conversation.update.mockResolvedValue({});

      const result = await service.deleteConversation('u1', 'c1');
      expect(result).toEqual({ success: true, disbanded: true });
    });

    it('should call hideDirectConversation() when type is DIRECT', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ type: ConversationType.DIRECT });
      prisma.participant.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.participant.update.mockResolvedValue({});

      const result = await service.deleteConversation('u1', 'c1');
      expect(result).toEqual({ success: true, hidden: true });
    });
  });

  // =========================================================================
  // hideDirectConversation()
  // =========================================================================
  describe('hideDirectConversation()', () => {
    it('should throw ForbiddenException if user is not a participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      await expect(service.hideDirectConversation('u1', 'c1'))
        .rejects.toThrow(ForbiddenException);
    });

    it('should set hiddenAt for the calling user only', async () => {
      prisma.participant.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.participant.update.mockResolvedValue({});

      const result = await service.hideDirectConversation('u1', 'c1');

      expect(result).toEqual({ success: true, hidden: true });
      expect(prisma.participant.update).toHaveBeenCalledWith({
        where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
        data: { hiddenAt: expect.any(Date) },
      });
    });
  });
});
