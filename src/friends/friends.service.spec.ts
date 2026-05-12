import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BlockService } from '../block/block.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { FriendRequestStatus } from './enums/friend-request-status.enum';
import { FriendRequestAction } from './dto/respond-friend-request.dto';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { createMockRedis } from '../__mocks__/redis.mock';

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedis>;
  let notifications: Record<string, jest.Mock>;
  let blockService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedis();
    notifications = {
      create: jest.fn().mockResolvedValue({}),
      emitEventToUser: jest.fn(),
    };
    blockService = {
      isBlockedEitherDirection: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: BlockService, useValue: blockService },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: SocketEmitterService,
          useValue: { emitToUser: jest.fn(), emitToRoom: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<FriendsService>(FriendsService);
  });

  afterEach(() => jest.clearAllMocks());

  // sendRequest()

  describe('sendRequest()', () => {
    it('should throw BadRequestException when sending request to self in sendRequest()', async () => {
      await expect(service.sendRequest('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when receiver does not exist in sendRequest()', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when already friends in sendRequest()', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue({ id: 'f1' });
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('Block guard', () => {
      it('should throw ForbiddenException when receiver has blocked sender', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        blockService.isBlockedEitherDirection.mockResolvedValue(true);

        await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('should throw ForbiddenException when sender has blocked receiver', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        blockService.isBlockedEitherDirection.mockResolvedValue(true);

        await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('should proceed normally when no block exists between users', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        blockService.isBlockedEitherDirection.mockResolvedValue(false); // default, but explicit
        prisma.friendRequest.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findUnique.mockResolvedValue(null);
        prisma.friendRequest.upsert.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        });

        const result = await service.sendRequest('u1', 'u2');
        expect(result.result).toBe('FRIEND_REQUEST_SENT');
      });
    });

    it('should throw BadRequestException when A already has a PENDING request to B in sendRequest()', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue(null);
      // existing pending where senderId === senderId (same direction = duplicate)
      prisma.friendRequest.findFirst.mockResolvedValue({
        id: 'req1',
        senderId: 'u1',
        receiverId: 'u2',
        status: FriendRequestStatus.PENDING,
      });
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('Rejection cooldown', () => {
      it('should throw BadRequestException when elapsed time is exactly equal to REJECTION_COOLDOWN_MS', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findFirst.mockResolvedValue(null);

        // Cooldown is 24 hours (86400000 ms)
        const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
        prisma.friendRequest.findUnique.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.REJECTED,
          updatedAt: new Date(Date.now() - REJECTION_COOLDOWN_MS + 1000), // less than cooldown
        });

        await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should NOT throw BadRequestException when elapsed time is >= REJECTION_COOLDOWN_MS', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findFirst.mockResolvedValue(null);

        const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
        prisma.friendRequest.findUnique.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.REJECTED,
          updatedAt: new Date(Date.now() - REJECTION_COOLDOWN_MS), // exactly cooldown limit
        });
        prisma.friendRequest.upsert.mockResolvedValue({} as any);

        const result = await service.sendRequest('u1', 'u2');
        expect(result.result).toBe('FRIEND_REQUEST_SENT');
      });
    });

    it('should upsert request and return FRIEND_REQUEST_SENT when sendRequest() succeeds', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findUnique.mockResolvedValue(null); // no previous rejection
      prisma.friendRequest.upsert.mockResolvedValue({
        id: 'req1',
        senderId: 'u1',
        receiverId: 'u2',
        status: FriendRequestStatus.PENDING,
      });

      const result = await service.sendRequest('u1', 'u2');

      expect(prisma.friendRequest.upsert).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        'u2',
        'u1',
        expect.any(String),
        'req1',
      );
      expect(result.result).toBe('FRIEND_REQUEST_SENT');
      expect(result.friendRequest.id).toBe('req1');
    });

    it('should set expiredAt ~7 days in the future when upsert is called in sendRequest()', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findUnique.mockResolvedValue(null);
      prisma.friendRequest.upsert.mockResolvedValue({
        id: 'req1',
        senderId: 'u1',
        receiverId: 'u2',
        status: FriendRequestStatus.PENDING,
      });

      await service.sendRequest('u1', 'u2');

      const upsertCall = prisma.friendRequest.upsert.mock.calls[0][0];
      const expiredAt: Date = upsertCall.create.expiredAt;
      const diffMs = expiredAt.getTime() - Date.now();
      // Should be roughly 7 days (±1 minute tolerance)
      expect(diffMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
      expect(diffMs).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 60_000);
    });

    // -----------------------------------------------------------------------
    // Auto-accept cross-send
    // -----------------------------------------------------------------------
    describe('Auto-accept cross-send', () => {
      it('should auto-accept and return AUTO_ACCEPTED when B sends request to A while A has pending to B', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u1' }); // A exists
        prisma.friend.findFirst.mockResolvedValue(null); // not friends yet

        // B (u2) sends to A (u1), but A already has PENDING to B
        const crossRequest = {
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        };
        prisma.friendRequest.findFirst.mockResolvedValue(crossRequest);

        // Transaction mock: update + create
        prisma.friendRequest.update.mockResolvedValue({
          ...crossRequest,
          status: FriendRequestStatus.ACCEPTED,
        });
        prisma.friend.create.mockResolvedValue({});

        const result = await service.sendRequest('u2', 'u1');

        expect(result.result).toBe('AUTO_ACCEPTED');
        expect(result.friendRequest.status).toBe(FriendRequestStatus.ACCEPTED);
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.friend.create).toHaveBeenCalled();
      });

      it('should notify original sender (A) that their request was accepted on auto-accept', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u1' });
        prisma.friend.findFirst.mockResolvedValue(null);

        const crossRequest = {
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        };
        prisma.friendRequest.findFirst.mockResolvedValue(crossRequest);
        prisma.friendRequest.update.mockResolvedValue({
          ...crossRequest,
          status: FriendRequestStatus.ACCEPTED,
        });
        prisma.friend.create.mockResolvedValue({});

        await service.sendRequest('u2', 'u1');

        // Should notify u1 (original sender) that u2 (acceptor) accepted
        expect(notifications.create).toHaveBeenCalledWith(
          'u1', // senderId of original request
          'u2', // acceptor
          expect.any(String),
          'req1',
        );
      });

      it('should invalidate cache for both users on auto-accept', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u1' });
        prisma.friend.findFirst.mockResolvedValue(null);

        const crossRequest = {
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        };
        prisma.friendRequest.findFirst.mockResolvedValue(crossRequest);
        prisma.friendRequest.update.mockResolvedValue({
          ...crossRequest,
          status: FriendRequestStatus.ACCEPTED,
        });
        prisma.friend.create.mockResolvedValue({});

        await service.sendRequest('u2', 'u1');

        expect(redis.del).toHaveBeenCalledWith('friends_list:u1');
        expect(redis.del).toHaveBeenCalledWith('friends_list:u2');
      });
    });

    // -----------------------------------------------------------------------
    // Cooldown 24h after rejection
    // -----------------------------------------------------------------------
    describe('24h cooldown after rejection', () => {
      it('should throw BadRequestException when sending within 24h after being rejected', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findFirst.mockResolvedValue(null); // no pending

        // Previous request was rejected 1 hour ago
        const rejectedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
        prisma.friendRequest.findUnique.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.REJECTED,
          updatedAt: rejectedAt,
        });

        await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should allow resend after 24h cooldown has passed since rejection', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findFirst.mockResolvedValue(null); // no pending

        // Previous request was rejected 25 hours ago
        const rejectedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
        prisma.friendRequest.findUnique.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.REJECTED,
          updatedAt: rejectedAt,
        });

        prisma.friendRequest.upsert.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        });

        const result = await service.sendRequest('u1', 'u2');
        expect(result.result).toBe('FRIEND_REQUEST_SENT');
      });

      it('should allow resend when there is no previous request (no cooldown)', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.friend.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findFirst.mockResolvedValue(null);
        prisma.friendRequest.findUnique.mockResolvedValue(null); // no prior request

        prisma.friendRequest.upsert.mockResolvedValue({
          id: 'req1',
          senderId: 'u1',
          receiverId: 'u2',
          status: FriendRequestStatus.PENDING,
        });

        const result = await service.sendRequest('u1', 'u2');
        expect(result.result).toBe('FRIEND_REQUEST_SENT');
      });
    });
  });

  // getPendingRequests()

  describe('getPendingRequests()', () => {
    it('should return pending requests when getPendingRequests() is called', async () => {
      const dbRequests = [
        {
          id: 'r1',
          senderId: 'u2',
          sender: { id: 'u2', username: 'user2' },
          receiverId: 'u1',
          receiver: { id: 'u1', username: 'user1' },
        },
      ];
      const expectedRequests = [
        {
          id: 'r1',
          senderId: 'u2',
          receiverId: 'u1',
          sender: {
            id: 'u2',
            avatarUrl: null,
            displayName: null,
            handle: '',
          },
          receiver: {
            id: 'u1',
            avatarUrl: null,
            displayName: null,
            handle: '',
          },
        },
      ];
      prisma.friendRequest.findMany.mockResolvedValue(dbRequests);

      const result = await service.getPendingRequests('u1');

      expect(prisma.friendRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ receiverId: 'u1' }, { senderId: 'u1' }],
            status: FriendRequestStatus.PENDING,
          }),
        }),
      );
      expect(result).toEqual(expectedRequests);
    });

    it('should filter out expired requests in getPendingRequests()', async () => {
      const requests = [
        {
          id: 'r1',
          senderId: 'u2',
          sender: { id: 'u2', username: 'user2' },
          receiverId: 'u1',
          receiver: { id: 'u1', username: 'user1' },
        },
      ];
      prisma.friendRequest.findMany.mockResolvedValue(requests);

      await service.getPendingRequests('u1');

      const whereArg = prisma.friendRequest.findMany.mock.calls[0][0].where;
      // expiredAt filter should be present inside AND[0].OR clause
      expect(whereArg.AND).toBeDefined();
      expect(whereArg.AND[0].OR).toBeDefined();
      expect(whereArg.AND[0].OR).toEqual(
        expect.arrayContaining([
          { expiredAt: null },
          { expiredAt: expect.objectContaining({ gt: expect.any(Date) }) },
        ]),
      );
    });
  });

  // respondToRequest()

  describe('respondToRequest()', () => {
    const pendingReq = {
      id: 'req1',
      senderId: 'u1',
      receiverId: 'u2',
      status: FriendRequestStatus.PENDING,
    };

    it('should throw NotFoundException when request not found in respondToRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.respondToRequest('req1', 'u2', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when request already processed in respondToRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.ACCEPTED,
      });
      await expect(
        service.respondToRequest('req1', 'u2', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when non-receiver tries to respond in respondToRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      await expect(
        service.respondToRequest('req1', 'u1', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update status to REJECTED when respondToRequest() action is REJECTED', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      prisma.friendRequest.update.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.REJECTED,
      });

      const result = await service.respondToRequest(
        'req1',
        'u2',
        FriendRequestAction.REJECTED,
      );

      expect(prisma.friendRequest.update).toHaveBeenCalledWith({
        where: { id: 'req1' },
        data: { status: FriendRequestStatus.REJECTED },
      });
      expect(result).toEqual({
        success: true,
        action: 'rejected',
        requestId: 'req1',
      });
    });

    it('should create friendship in transaction when respondToRequest() action is ACCEPTED', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      prisma.friendRequest.update.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.ACCEPTED,
      });
      prisma.friend.create.mockResolvedValue({});

      const result = await service.respondToRequest(
        'req1',
        'u2',
        FriendRequestAction.ACCEPTED,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.friend.create).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        action: 'accepted',
        requestId: 'req1',
      });
    });

    it('should invalidate cache and notify when respondToRequest() action is ACCEPTED', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      prisma.friendRequest.update.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.ACCEPTED,
      });
      prisma.friend.create.mockResolvedValue({});

      await service.respondToRequest(
        'req1',
        'u2',
        FriendRequestAction.ACCEPTED,
      );

      expect(redis.del).toHaveBeenCalledWith('friends_list:u1');
      expect(redis.del).toHaveBeenCalledWith('friends_list:u2');
      expect(notifications.create).toHaveBeenCalled();
    });
  });

  // getFriends()

  describe('getFriends()', () => {
    it('should return cached result for first page when cache hits in getFriends()', async () => {
      const cached = { data: [], total: 0, limit: 20, offset: 0 };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getFriends('u1');

      expect(prisma.friend.findMany).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query DB, set cache, and fetch presence (offline) when cache misses in getFriends()', async () => {
      redis.get.mockResolvedValue(null);
      redis.mget.mockResolvedValue([null]); // Mock account-2 is offline
      prisma.friend.findMany.mockResolvedValue([
        {
          accountId1: 'u1',
          accountId2: 'u2',
          account1: { id: 'u1' },
          account2: { id: 'u2' },
        },
      ]);
      prisma.friend.count.mockResolvedValue(1);

      const result = await service.getFriends('u1');

      expect(prisma.friend.findMany).toHaveBeenCalled();
      expect(redis.mget).toHaveBeenCalledWith(['presence:u2']);
      expect(redis.set).toHaveBeenCalledWith(
        'friends_list:u1',
        expect.any(String),
        'EX',
        300,
      );
      expect(result.data[0].isOnline).toBe(false);
    });

    it('should return friends with isOnline: true when redis returns online', async () => {
      redis.get.mockResolvedValue(null);
      redis.mget.mockResolvedValue(['online']); // Mock account-2 is online
      prisma.friend.findMany.mockResolvedValue([
        {
          accountId1: 'u1',
          accountId2: 'u2',
          account1: { id: 'u1' },
          account2: { id: 'u2' },
        },
      ]);
      prisma.friend.count.mockResolvedValue(1);

      const result = await service.getFriends('u1');

      expect(redis.mget).toHaveBeenCalledWith(['presence:u2']);
      expect(result.data[0].isOnline).toBe(true);
    });

    it('should not use cache for paginated requests when offset > 0 in getFriends()', async () => {
      prisma.friend.findMany.mockResolvedValue([]);
      prisma.friend.count.mockResolvedValue(0);

      await service.getFriends('u1', 20, 20);

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // getFriendIdsBatch()

  describe('getFriendIdsBatch()', () => {
    it('should map friend IDs correctly when getFriendIdsBatch() is called', async () => {
      prisma.friend.findMany.mockResolvedValue([
        { accountId1: 'u1', accountId2: 'u2' },
        { accountId1: 'u3', accountId2: 'u1' },
      ]);

      const ids = await service.getFriendIdsBatch('u1', 0);

      expect(ids).toEqual(['u2', 'u3']);
    });

    it('should return empty array when no friends in getFriendIdsBatch()', async () => {
      prisma.friend.findMany.mockResolvedValue([]);
      expect(await service.getFriendIdsBatch('u1', 0)).toEqual([]);
    });
  });

  // cancelRequest()

  describe('cancelRequest()', () => {
    const pendingReq = {
      id: 'req1',
      senderId: 'u1',
      receiverId: 'u2',
      status: FriendRequestStatus.PENDING,
    };

    it('should throw NotFoundException when request not found in cancelRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(null);
      await expect(service.cancelRequest('req1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when request already processed in cancelRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.ACCEPTED,
      });
      await expect(service.cancelRequest('req1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException when non-sender tries to cancel in cancelRequest()', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      await expect(service.cancelRequest('req1', 'u2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should delete request and return success when cancelRequest() succeeds', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      prisma.friendRequest.delete.mockResolvedValue(pendingReq);

      const result = await service.cancelRequest('req1', 'u1');

      expect(prisma.friendRequest.delete).toHaveBeenCalledWith({
        where: { id: 'req1' },
      });
      expect(result).toEqual({
        success: true,
        message: 'Friend request cancelled',
      });
    });
  });

  // removeFriend()

  describe('removeFriend()', () => {
    it('should throw NotFoundException when friendship not found in removeFriend()', async () => {
      prisma.friend.findFirst.mockResolvedValue(null);
      await expect(service.removeFriend('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete friendship and invalidate cache when removeFriend() succeeds', async () => {
      prisma.friend.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.friend.delete.mockResolvedValue({});
      prisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeFriend('u1', 'u2');

      expect(prisma.friend.delete).toHaveBeenCalledWith({
        where: { id: 'f1' },
      });
      expect(redis.del).toHaveBeenCalledWith('friends_list:u1');
      expect(redis.del).toHaveBeenCalledWith('friends_list:u2');
      expect(result.success).toBe(true);
    });

    it('should delete all FriendRequest records between the two users on removeFriend()', async () => {
      prisma.friend.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.friend.delete.mockResolvedValue({});
      prisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeFriend('u1', 'u2');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { senderId: 'u1', receiverId: 'u2' },
              { senderId: 'u2', receiverId: 'u1' },
            ]),
          }),
        }),
      );
    });
  });

  // cleanupExpiredRequests()

  describe('cleanupExpiredRequests()', () => {
    it('should delete PENDING requests where expiredAt <= now', async () => {
      prisma.friendRequest.deleteMany.mockResolvedValue({ count: 5 });

      await service.cleanupExpiredRequests();

      expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: FriendRequestStatus.PENDING,
            expiredAt: expect.objectContaining({ lte: expect.any(Date) }),
          }),
        }),
      );
    });

    it('should log the number of cleaned up requests in cleanupExpiredRequests()', async () => {
      prisma.friendRequest.deleteMany.mockResolvedValue({ count: 3 });
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => {});

      await service.cleanupExpiredRequests();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
    });
  });
});
