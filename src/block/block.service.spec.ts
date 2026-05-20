import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { BlockService } from './block.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { REDIS_CLIENT } from '../redis/redis.module';

describe('BlockService', () => {
  let service: BlockService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: any;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = {
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<BlockService>(BlockService);
  });

  afterEach(() => jest.clearAllMocks());

  // blockUser()

  describe('blockUser()', () => {
    it('should throw BadRequestException when blocking self', async () => {
      await expect(service.blockUser('u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when target account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.blockUser('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when account is already blocked', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.block.findUnique.mockResolvedValue({
        blockerId: 'u1',
        blockedId: 'u2',
      });
      await expect(service.blockUser('u1', 'u2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create block record and return BlockResponse on success', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
      prisma.block.findUnique.mockResolvedValue(null); // not blocked yet
      prisma.block.create.mockResolvedValue({
        blockerId: 'u1',
        blockedId: 'u2',
      });
      prisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });
      prisma.friend.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.blockUser('u1', 'u2');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        blocked: true,
        targetUserId: 'u2',
      });
      expect(redis.del).toHaveBeenCalledWith('user_profile:u1');
      expect(redis.del).toHaveBeenCalledWith('user_profile:u2');
    });

    describe('Block cancels pending friend request and removes friendship', () => {
      it('should delete pending friend requests in both directions', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.block.findUnique.mockResolvedValue(null);
        prisma.block.create.mockResolvedValue({});
        prisma.friendRequest.deleteMany.mockResolvedValue({ count: 1 });
        prisma.friend.deleteMany.mockResolvedValue({ count: 0 });

        await service.blockUser('u1', 'u2');

        expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: 'pending',
            }),
          }),
        );
      });

      it('should delete friendship record when they are friends', async () => {
        prisma.account.findUnique.mockResolvedValue({ id: 'u2' });
        prisma.block.findUnique.mockResolvedValue(null);
        prisma.block.create.mockResolvedValue({});
        prisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });
        prisma.friend.deleteMany.mockResolvedValue({ count: 1 });

        await service.blockUser('u1', 'u2');

        expect(prisma.friend.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                { accountId1: 'u1', accountId2: 'u2' },
                { accountId1: 'u2', accountId2: 'u1' },
              ]),
            }),
          }),
        );
      });
    });
  });

  // unblockUser()

  describe('unblockUser()', () => {
    it('should throw NotFoundException when block record does not exist', async () => {
      prisma.block.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.unblockUser('u1', 'u2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete block record and return success', async () => {
      prisma.block.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.unblockUser('u1', 'u2');

      expect(prisma.block.deleteMany).toHaveBeenCalledWith({
        where: { blockerId: 'u1', blockedId: 'u2' },
      });
      expect(result).toEqual({
        success: true,
        blocked: false,
        targetUserId: 'u2',
      });
      expect(redis.del).toHaveBeenCalledWith('user_profile:u1');
      expect(redis.del).toHaveBeenCalledWith('user_profile:u2');
    });
  });

  // getBlockedUsers()

  describe('getBlockedUsers()', () => {
    it('should return list of blocked users with blockedAt', async () => {
      const now = new Date();
      prisma.block.findMany.mockResolvedValue([
        {
          createdAt: now,
          blocked: {
            id: 'u2',
            profile: { handle: 'bob', displayName: null, avatarUrl: null },
          },
        },
      ]);

      const result = await service.getBlockedUsers('u1');

      expect(result).toEqual([
        {
          id: 'u2',
          handle: 'bob',
          displayName: null,
          avatarUrl: null,
          blockedAt: now,
        },
      ]);
    });

    it('should return empty array when no users are blocked', async () => {
      prisma.block.findMany.mockResolvedValue([]);
      const result = await service.getBlockedUsers('u1');
      expect(result).toEqual([]);
    });
  });

  // isBlockedEitherDirection()

  describe('isBlockedEitherDirection()', () => {
    it('should return true when A has blocked B', async () => {
      prisma.block.findFirst.mockResolvedValue({
        blockerId: 'u1',
        blockedId: 'u2',
      });
      expect(await service.isBlockedEitherDirection('u1', 'u2')).toBe(true);
    });

    it('should return true when B has blocked A', async () => {
      prisma.block.findFirst.mockResolvedValue({
        blockerId: 'u2',
        blockedId: 'u1',
      });
      expect(await service.isBlockedEitherDirection('u1', 'u2')).toBe(true);
    });

    it('should return false when neither has blocked the other', async () => {
      prisma.block.findFirst.mockResolvedValue(null);
      expect(await service.isBlockedEitherDirection('u1', 'u2')).toBe(false);
    });
  });
});
