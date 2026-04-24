import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { createMockRedis } from '../__mocks__/redis.mock';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

const mockUser = (o: Record<string, any> = {}) => ({
  id: 'user-1',
  username: 'testuser',
  email: 'test@test.com',
  passwordHash: 'hashed',
  authProviders: [{ provider: 'password', providerUserId: null }],
  avatarUrl: null,
  createdAt: new Date('2025-01-01'),
  lastSeen: null,
  profile: {
    accountId: 'user-1',
    handle: 'testuser',
    displayName: null,
    avatarUrl: null,
    isOnline: false,
  },
  ...o,
});

describe('UserService', () => {
  let service: UserService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedis();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create()', () => {
    it('should call prisma.account.create with provided data when valid account data is provided', async () => {
      const data = {
        email: 'new@test.com',
        username: 'newuser',
        passwordHash: 'h',
      };
      prisma.account.create.mockResolvedValue(mockUser(data));
      const result = await service.create(data);
      expect(prisma.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining(data),
        include: { profile: true },
      });
      expect(result.email).toBe(data.email);
    });

    it('should retry generating a handle if the generated handle is already taken', async () => {
      const data = {
        email: 'new@test.com',
        username: 'newuser',
        passwordHash: 'h',
      };
      // First call to findUnique returns an existing profile (collision), second call returns null (unique)
      prisma.profile.findUnique
        .mockResolvedValueOnce(mockUser().profile as any)
        .mockResolvedValueOnce(null as any);

      prisma.account.create.mockResolvedValue(mockUser(data));

      await service.create(data);

      // findUnique should have been called twice due to the collision
      expect(prisma.profile.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.account.create).toHaveBeenCalled();
    });
  });

  describe('findByEmail()', () => {
    it('should return account when account exists with given email', async () => {
      prisma.account.findUnique.mockResolvedValue(mockUser());
      const result = await service.findByEmail('test@test.com');
      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
        include: { profile: true },
      });
      expect(result).toBeTruthy();
    });
  });

  describe('findByUsername()', () => {
    it('should return account when account exists with given username', async () => {
      prisma.account.findUnique.mockResolvedValue(mockUser());
      const result = await service.findByUsername('testuser');
      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: { username: 'testuser' },
        include: { profile: true },
      });
      expect(result).toBeTruthy();
    });
  });

  describe('findById()', () => {
    it('should return account when account exists with given ID', async () => {
      prisma.account.findUnique.mockResolvedValue(mockUser());
      expect(await service.findById('user-1')).toBeTruthy();
    });

    it('should throw NotFoundException when account does not exist with given ID', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile()', () => {
    it('should update account and invalidate cache when valid profile data is provided', async () => {
      const mockAcct = mockUser({ username: 'newname' });
      prisma.profile.update.mockResolvedValue({
        ...mockAcct.profile,
        account: mockAcct,
      });
      await service.updateProfile('user-1', { handle: 'newname' });
      expect(prisma.profile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountId: 'user-1' } }),
      );
      expect(redis.del).toHaveBeenCalledWith('user_profile:user-1');
    });
  });

  describe('searchByHandle()', () => {
    it('should return friends matching handle when scope is friends', async () => {
      const friendships = [{ accountId1: 'u1', accountId2: 'f1' }];
      prisma.friend.findMany.mockResolvedValue(friendships);

      const profiles = [
        {
          accountId: 'f1',
          handle: 'testfriend',
          displayName: null,
          avatarUrl: null,
        },
      ];
      prisma.profile.findMany.mockResolvedValue(profiles);

      const result = await service.searchByHandle('test', 'friends', 'u1');

      expect(prisma.friend.findMany).toHaveBeenCalled();
      expect(prisma.profile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ accountId: { in: ['f1'] } }),
        }),
      );
      expect(result).toEqual([
        {
          id: 'f1',
          handle: 'testfriend',
          displayName: null,
          avatarUrl: null,
          isFriend: true,
          friendRequestStatus: null,
        },
      ]);
    });

    it('should return matching users and attach friendship status when scope is all', async () => {
      const profiles = [
        {
          accountId: 'user-2',
          handle: 'other',
          displayName: null,
          avatarUrl: null,
        },
      ];
      prisma.profile.findMany.mockResolvedValue(profiles);

      prisma.friend.findMany.mockResolvedValue([]);
      prisma.friendRequest.findMany.mockResolvedValue([
        { senderId: 'u1', receiverId: 'user-2', status: 'pending' },
      ]);

      const result = await service.searchByHandle('other', 'all', 'u1');

      expect(prisma.profile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ accountId: { not: 'u1' } }),
        }),
      );
      expect(result).toEqual([
        {
          id: 'user-2',
          handle: 'other',
          displayName: null,
          avatarUrl: null,
          isFriend: false,
          friendRequestStatus: 'sent',
        },
      ]);
    });

    it('should return empty array when no account matches the search query for scope all', async () => {
      prisma.profile.findMany.mockResolvedValue([]);
      expect(await service.searchByHandle('zzz', 'all', 'u1')).toEqual([]);
    });
  });

  describe('getUserProfile()', () => {
    const profile = mockUser();

    it('should return cached profile without querying DB when profile is found in cache', async () => {
      redis.get.mockResolvedValue(JSON.stringify(profile));
      await service.getUserProfile('user-1');
      expect(prisma.account.findUnique).not.toHaveBeenCalled();
    });

    it('should query DB and set cache when profile is not found in cache', async () => {
      redis.get.mockResolvedValue(null);
      prisma.account.findUnique.mockResolvedValue(profile);
      await service.getUserProfile('user-1');
      expect(redis.set).toHaveBeenCalledWith(
        'user_profile:user-1',
        expect.any(String),
        'EX',
        3600,
      );
    });

    it('should throw NotFoundException when account does not exist in cache or DB', async () => {
      redis.get.mockResolvedValue(null);
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.getUserProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateLastSeen()', () => {
    it('should update lastSeen and invalidate cache when account is active', async () => {
      prisma.account.update.mockResolvedValue(mockUser());
      await service.updateLastSeen('user-1');
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { lastSeen: expect.any(Date) },
        }),
      );
      expect(redis.del).toHaveBeenCalledWith('user_profile:user-1');
    });
  });

  describe('changePassword()', () => {
    it('should throw NotFoundException if account not found', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('u1', 'old', 'new')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if account has no password provider', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({
          authProviders: [{ provider: 'google', providerUserId: '123' }],
        }),
      );
      await expect(
        service.changePassword('u1', 'wrong', 'new'),
      ).rejects.toThrow();
    });

    it('should throw UnauthorizedException if old password does not match', async () => {
      prisma.account.findUnique.mockResolvedValue(mockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.changePassword('u1', 'wrong', 'new'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should update password and invalidate sessions when successful', async () => {
      prisma.account.findUnique.mockResolvedValue(mockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newhash');
      prisma.account.update.mockResolvedValue({});
      prisma.refreshToken.deleteMany.mockResolvedValue({});
      prisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.changePassword('u1', 'old', 'new');

      expect(bcrypt.compare).toHaveBeenCalledWith('old', 'hashed');
      expect(bcrypt.hash).toHaveBeenCalledWith('new', 10);
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { passwordHash: 'newhash' } }),
      );
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { accountId: 'u1' },
      });
      expect(result).toEqual({ success: true, message: expect.any(String) });
    });
  });
});
