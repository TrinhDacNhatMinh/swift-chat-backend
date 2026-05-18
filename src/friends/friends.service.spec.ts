import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { FriendRequestStatus } from './enums/friend-request-status.enum';
import { FriendRequestAction } from './dto/respond-friend-request.dto';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { createMockRedis } from '../__mocks__/redis.mock';

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedis>;
  let notifications: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedis();
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get<FriendsService>(FriendsService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // sendRequest()
  // =========================================================================
  describe('sendRequest()', () => {
    it('should throw when sending request to self', async () => {
      await expect(service.sendRequest('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when receiver does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw when already friends', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue({ id: 'f1' });
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when pending request already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findFirst.mockResolvedValue({ id: 'req1' });
      await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should upsert request and create notification on success', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.friend.findFirst.mockResolvedValue(null);
      prisma.friendRequest.findFirst.mockResolvedValue(null);
      prisma.friendRequest.upsert.mockResolvedValue({
        id: 'req1',
        senderId: 'u1',
        receiverId: 'u2',
      });

      const result = await service.sendRequest('u1', 'u2');

      expect(prisma.friendRequest.upsert).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        'u2',
        'u1',
        expect.any(String),
        'req1',
      );
      expect(result.id).toBe('req1');
    });
  });

  // =========================================================================
  // getPendingRequests()
  // =========================================================================
  describe('getPendingRequests()', () => {
    it('should return pending requests for user', async () => {
      const requests = [{ id: 'r1', senderId: 'u2' }];
      prisma.friendRequest.findMany.mockResolvedValue(requests);

      const result = await service.getPendingRequests('u1');

      expect(prisma.friendRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { receiverId: 'u1', status: FriendRequestStatus.PENDING },
        }),
      );
      expect(result).toEqual(requests);
    });
  });

  // =========================================================================
  // respondToRequest()
  // =========================================================================
  describe('respondToRequest()', () => {
    const pendingReq = {
      id: 'req1',
      senderId: 'u1',
      receiverId: 'u2',
      status: FriendRequestStatus.PENDING,
    };

    it('should throw when request not found', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.respondToRequest('req1', 'u2', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when request already processed', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.ACCEPTED,
      });
      await expect(
        service.respondToRequest('req1', 'u2', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when non-receiver tries to respond', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      await expect(
        service.respondToRequest('req1', 'u1', FriendRequestAction.ACCEPTED),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update status to REJECTED on reject', async () => {
      prisma.friendRequest.findUnique.mockResolvedValue(pendingReq);
      prisma.friendRequest.update.mockResolvedValue({
        ...pendingReq,
        status: FriendRequestStatus.REJECTED,
      });

      await service.respondToRequest(
        'req1',
        'u2',
        FriendRequestAction.REJECTED,
      );

      expect(prisma.friendRequest.update).toHaveBeenCalledWith({
        where: { id: 'req1' },
        data: { status: FriendRequestStatus.REJECTED },
      });
    });

    it('should create friendship in transaction on accept', async () => {
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

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.friend.create).toHaveBeenCalled();
    });

    it('should invalidate cache and notify on accept', async () => {
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

  // =========================================================================
  // getFriends()
  // =========================================================================
  describe('getFriends()', () => {
    it('should return cached result for first page on cache hit', async () => {
      const cached = { data: [], total: 0, limit: 20, offset: 0 };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getFriends('u1');

      expect(prisma.friend.findMany).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('should query DB and set cache for first page on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      prisma.friend.findMany.mockResolvedValue([
        {
          userId1: 'u1',
          userId2: 'u2',
          user1: { id: 'u1' },
          user2: { id: 'u2' },
        },
      ]);
      prisma.friend.count.mockResolvedValue(1);

      await service.getFriends('u1');

      expect(prisma.friend.findMany).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'friends_list:u1',
        expect.any(String),
        'EX',
        300,
      );
    });

    it('should not use cache for paginated requests', async () => {
      prisma.friend.findMany.mockResolvedValue([]);
      prisma.friend.count.mockResolvedValue(0);

      await service.getFriends('u1', 20, 20);

      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getFriendIdsBatch()
  // =========================================================================
  describe('getFriendIdsBatch()', () => {
    it('should map friend IDs correctly', async () => {
      prisma.friend.findMany.mockResolvedValue([
        { userId1: 'u1', userId2: 'u2' },
        { userId1: 'u3', userId2: 'u1' },
      ]);

      const ids = await service.getFriendIdsBatch('u1', 0);

      expect(ids).toEqual(['u2', 'u3']);
    });

    it('should return empty array when no friends', async () => {
      prisma.friend.findMany.mockResolvedValue([]);
      expect(await service.getFriendIdsBatch('u1', 0)).toEqual([]);
    });
  });

  // =========================================================================
  // removeFriend()
  // =========================================================================
  describe('removeFriend()', () => {
    it('should throw when friendship not found', async () => {
      prisma.friend.findFirst.mockResolvedValue(null);
      await expect(service.removeFriend('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete friendship and invalidate cache', async () => {
      prisma.friend.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.friend.delete.mockResolvedValue({});

      const result = await service.removeFriend('u1', 'u2');

      expect(prisma.friend.delete).toHaveBeenCalledWith({
        where: { id: 'f1' },
      });
      expect(redis.del).toHaveBeenCalledWith('friends_list:u1');
      expect(redis.del).toHaveBeenCalledWith('friends_list:u2');
      expect(result.success).toBe(true);
    });
  });
});
