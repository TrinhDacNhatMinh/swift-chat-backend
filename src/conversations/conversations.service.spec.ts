import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType, ParticipantRole } from './enums/conversation.enum';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { MessagesService } from '../messages/messages.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { BlockService } from '../block/block.service';

const fixedDate = new Date('2026-05-20T14:54:15.000Z');

const mockConversation = (o: Record<string, any> = {}) => ({
  id: 'c1',
  type: ConversationType.DIRECT,
  title: null,
  avatarUrl: null,
  createdAt: fixedDate,
  updatedAt: fixedDate,
  deletedAt: null,
  participants: [],
  ...o,
});

const mockParticipant = (o: Record<string, any> = {}) => ({
  id: 'p1',
  conversationId: 'c1',
  accountId: 'u1',
  role: ParticipantRole.MEMBER,
  joinedAt: fixedDate,
  lastReadMessageId: null,
  hiddenAt: null,
  ...o,
});

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: MessagesService,
          useValue: {
            getMessages: jest.fn(),
            findByConversation: jest.fn().mockResolvedValue([]),
            countUnreadInConversations: jest.fn().mockResolvedValue(new Map()),
            getLastMessagesForConversations: jest
              .fn()
              .mockResolvedValue(new Map()),
          },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: SocketEmitterService,
          useValue: { emitToUser: jest.fn(), emitToRoom: jest.fn() },
        },
        {
          provide: BlockService,
          useValue: {
            isBlockedEitherDirection: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();
    service = module.get<ConversationsService>(ConversationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // createConversation()

  describe('createConversation()', () => {
    it('should throw BadRequestException when attempting to create DIRECT conversation without partnerId', async () => {
      await expect(
        service.createConversation('u1', { type: ConversationType.DIRECT }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when attempting to create DIRECT conversation with oneself', async () => {
      await expect(
        service.createConversation('u1', {
          type: ConversationType.DIRECT,
          partnerId: 'u1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when attempting to create GROUP conversation without memberIds', async () => {
      await expect(
        service.createConversation('u1', { type: ConversationType.GROUP }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when attempting to create GROUP conversation with empty memberIds', async () => {
      await expect(
        service.createConversation('u1', {
          type: ConversationType.GROUP,
          memberIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // createOrGetDirectConversation (indirect via createConversation)

  describe('DIRECT conversation', () => {
    it('should throw NotFoundException when partner is not found in database', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(
        service.createConversation('u1', {
          type: ConversationType.DIRECT,
          partnerId: 'u2',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing conversation when DIRECT conversation already exists', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      const existing = mockConversation({
        id: 'conv1',
        type: ConversationType.DIRECT,
        participants: [],
      });
      prisma.participant.findFirst.mockResolvedValue(
        mockParticipant({
          conversation: existing,
        }),
      );

      const result = await service.createConversation('u1', {
        type: ConversationType.DIRECT,
        partnerId: 'u2',
      });

      expect(result).toEqual(existing);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should create new conversation with two participants when DIRECT conversation does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.participant.findFirst.mockResolvedValue(null);
      const newConv = mockConversation({
        id: 'conv-new',
        type: ConversationType.DIRECT,
        participants: [],
      });
      prisma.conversation.create.mockResolvedValue(newConv);
      prisma.participant.createMany.mockResolvedValue({ count: 2 });
      prisma.conversation.findUnique.mockResolvedValue(newConv);

      await service.createConversation('u1', {
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

  // createGroupConversation (indirect via createConversation)

  describe('GROUP conversation', () => {
    it('should create group with creator as LEADER when creating GROUP conversation', async () => {
      const newConv = mockConversation({
        id: 'g1',
        type: ConversationType.GROUP,
        title: 'Test',
        participants: [],
      });
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
        expect.objectContaining({
          accountId: 'u1',
          role: ParticipantRole.LEADER,
        }),
      );
      // Others should be MEMBER
      expect(records[1]).toEqual(
        expect.objectContaining({ role: ParticipantRole.MEMBER }),
      );
    });

    it('should deduplicate memberIds and exclude creator when creating GROUP conversation', async () => {
      prisma.conversation.create.mockResolvedValue({ id: 'g1' });
      prisma.participant.createMany.mockResolvedValue({ count: 2 });
      prisma.conversation.findUnique.mockResolvedValue(
        mockConversation({
          id: 'g1',
          type: ConversationType.GROUP,
          participants: [],
        }),
      );

      await service.createConversation('u1', {
        type: ConversationType.GROUP,
        memberIds: ['u2', 'u2', 'u1'], // duplicates + creator
      });

      const records = prisma.participant.createMany.mock.calls[0][0].data;
      // Should be: creator(u1) + u2 only (u1 deduplicated, u2 deduplicated)
      expect(records).toHaveLength(2);
    });
  });

  // getUserConversations()

  describe('getUserConversations()', () => {
    it('should return paginated conversations when valid pagination parameters are provided', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        mockConversation({ id: 'c1' }),
      ]);
      prisma.conversation.count.mockResolvedValue(1);
      prisma.participant.findMany.mockResolvedValue([
        mockParticipant({ id: 'p1', accountId: 'u1' }),
      ]);
      prisma.profile.findMany.mockResolvedValue([]);

      const result = await service.getUserConversations('u1', 20, undefined);

      expect(result).toEqual({
        data: [
          {
            id: 'c1',
            type: 'direct',
            displayInfo: { title: null, avatarUrl: null, isOnline: false },
            createdAt: new Date('2026-05-20T14:54:15.000Z'),
            updatedAt: new Date('2026-05-20T14:54:15.000Z'),
            unreadCount: 0,
            currentParticipant: {
              role: 'member',
              isMuted: false,
              mutedUntil: null,
              lastReadMessageId: null,
            },
            participantPreview: [],
            totalParticipants: 0,
            lastMessage: null,
          },
        ],
        nextCursor: null,
        hasMore: false,
      });
    });
  });

  // conversationExists()

  describe('conversationExists()', () => {
    it('should return true when conversation exists', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        mockConversation({ id: 'c1' }),
      );
      expect(await service.conversationExists('c1')).toBe(true);
    });

    it('should return false when conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      expect(await service.conversationExists('x')).toBe(false);
    });
  });

  // isParticipant()

  describe('isParticipant()', () => {
    it('should return true when account is participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(
        mockParticipant({ id: 'p1' }),
      );
      expect(await service.isParticipant('u1', 'c1')).toBe(true);
    });

    it('should return false when account is not participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      expect(await service.isParticipant('u1', 'c1')).toBe(false);
    });
  });

  // markAsRead()

  describe('markAsRead()', () => {
    it('should update lastReadMessageId when markAsRead is called', async () => {
      prisma.participant.update.mockResolvedValue({});
      await service.markAsRead('u1', 'c1', 'msg1');
      expect(prisma.participant.update).toHaveBeenCalledWith({
        where: {
          conversationId_accountId: { conversationId: 'c1', accountId: 'u1' },
        },
        data: { lastReadMessageId: 'msg1' },
      });
    });
  });

  // getReadReceipts()

  describe('getReadReceipts()', () => {
    it('should throw ForbiddenException if account is not a participant', async () => {
      jest.spyOn(service, 'isParticipant').mockResolvedValue(false);
      await expect(service.getReadReceipts('u1', 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return all participant read receipts when getReadReceipts is called', async () => {
      jest.spyOn(service, 'isParticipant').mockResolvedValue(true);
      const receipts = [{ accountId: 'u1', lastReadMessageId: 'msg1' }];
      prisma.participant.findMany.mockResolvedValue(receipts);

      const result = await service.getReadReceipts('u1', 'c1');

      expect(prisma.participant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 'c1' } }),
      );
      expect(result).toEqual(receipts);
    });
  });

  // hideDirectConversation()

  describe('hideDirectConversation()', () => {
    it('should throw ForbiddenException when account is not a participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      await expect(service.hideDirectConversation('u1', 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should set hiddenAt for the calling account only when valid request is made', async () => {
      prisma.participant.findUnique.mockResolvedValue(
        mockParticipant({ id: 'p1' }),
      );
      prisma.participant.update.mockResolvedValue({});

      const result = await service.hideDirectConversation('u1', 'c1');

      expect(result).toEqual({ success: true, hidden: true });
      expect(prisma.participant.update).toHaveBeenCalledWith({
        where: {
          conversationId_accountId: { conversationId: 'c1', accountId: 'u1' },
        },
        data: { hiddenAt: expect.any(Date) },
      });
    });
  });

  describe('getMembers()', () => {
    it('should throw ForbiddenException when account is not participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      await expect(service.getMembers('u1', 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return member list when account is participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(mockParticipant());
      prisma.participant.findMany.mockResolvedValue([
        {
          accountId: 'u1',
          role: 'LEADER',
          joinedAt: new Date(),
          account: {
            profile: { handle: 'account1', avatarUrl: 'url1' },
            lastSeen: new Date(),
          },
        },
      ]);
      const result = await service.getMembers('u1', 'c1');
      expect(result.length).toBe(1);
      expect(result[0].handle).toBe('account1');
    });
  });

  describe('muteConversation()', () => {
    it('should throw ForbiddenException when account is not participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      await expect(
        service.muteConversation('u1', 'c1', '1h' as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update mutedUntil for participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(mockParticipant());
      prisma.participant.update.mockResolvedValue({});
      const result = await service.muteConversation('u1', 'c1', '1h');
      expect(prisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mutedUntil: expect.any(Date) },
        }),
      );
      expect(result).toEqual({ success: true, mutedUntil: expect.any(Date) });
    });
  });

  describe('unmuteConversation()', () => {
    it('should throw ForbiddenException when account is not participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(null);
      await expect(service.unmuteConversation('u1', 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should set mutedUntil to null for participant', async () => {
      prisma.participant.findUnique.mockResolvedValue(mockParticipant());
      prisma.participant.update.mockResolvedValue({});
      const result = await service.unmuteConversation('u1', 'c1');
      expect(prisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mutedUntil: null },
        }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('mapParticipants()', () => {
    it('should return accountId and user object without account field', () => {
      const mockP = {
        id: 'p1',
        conversationId: 'c1',
        accountId: 'u1',
        role: 'MEMBER',
        joinedAt: new Date(),
        hiddenAt: null,
        mutedUntil: null,
        account: {
          id: 'u1',
          username: 'user1',
          lastSeen: new Date(),
          profile: {
            handle: 'user1_handle',
            displayName: 'User One',
            avatarUrl: 'url',
          },
        },
      };

      const result = service['mapParticipants']([mockP]);

      expect(result[0]).toHaveProperty('accountId', 'u1');
      expect(result[0]).not.toHaveProperty('userId');
      expect(result[0]).not.toHaveProperty('account');
      expect(result[0]).toHaveProperty('user');
      expect(result[0].user).toHaveProperty('id', 'u1');
      expect(result[0].user).toHaveProperty('handle', 'user1_handle');
    });
  });
});
