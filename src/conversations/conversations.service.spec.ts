import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    it('should create group with creator as ADMIN', async () => {
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
        expect.objectContaining({ userId: 'u1', role: ParticipantRole.ADMIN }),
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
  });
});
