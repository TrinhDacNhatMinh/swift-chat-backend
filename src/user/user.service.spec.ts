import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { createMockRedis } from '../__mocks__/redis.mock';

const mockUser = (o: Record<string, any> = {}) => ({
  id: 'user-1',
  username: 'testuser',
  email: 'test@test.com',
  passwordHash: 'hashed',
  authProvider: 'local',
  providerId: null,
  avatarUrl: null,
  createdAt: new Date('2025-01-01'),
  lastSeen: null,
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
    it('should call prisma.user.create with provided data', async () => {
      const data = {
        email: 'new@test.com',
        username: 'newuser',
        passwordHash: 'h',
        authProvider: 'local',
      };
      prisma.user.create.mockResolvedValue(mockUser(data));
      const result = await service.create(data);
      expect(prisma.user.create).toHaveBeenCalledWith({ data });
      expect(result.email).toBe(data.email);
    });
  });

  describe('findByEmail()', () => {
    it('should return user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      const result = await service.findByEmail('test@test.com');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
      expect(result).toBeTruthy();
    });
  });

  describe('findByUsername()', () => {
    it('should return user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      const result = await service.findByUsername('testuser');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'testuser' },
      });
      expect(result).toBeTruthy();
    });
  });

  describe('findById()', () => {
    it('should return user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      expect(await service.findById('user-1')).toBeTruthy();
    });

    it('should throw NotFoundException when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile()', () => {
    it('should update user and invalidate cache', async () => {
      prisma.user.update.mockResolvedValue(mockUser({ username: 'newname' }));
      await service.updateProfile('user-1', { username: 'newname' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
      expect(redis.del).toHaveBeenCalledWith('user_profile:user-1');
    });
  });

  describe('searchUsers()', () => {
    it('should return matching users excluding current user', async () => {
      const users = [{ id: 'user-2', username: 'other', avatarUrl: null }];
      prisma.user.findMany.mockResolvedValue(users);
      const result = await service.searchUsers('other', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'user-1' } }),
        }),
      );
      expect(result).toEqual(users);
    });

    it('should return empty array when no match', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      expect(await service.searchUsers('zzz', 'user-1')).toEqual([]);
    });
  });

  describe('getUserProfile()', () => {
    const profile = {
      id: 'user-1',
      username: 'testuser',
      avatarUrl: null,
      createdAt: new Date(),
      lastSeen: null,
    };

    it('should return cached profile without DB query', async () => {
      redis.get.mockResolvedValue(JSON.stringify(profile));
      await service.getUserProfile('user-1');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should query DB and set cache on miss', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(profile);
      await service.getUserProfile('user-1');
      expect(redis.set).toHaveBeenCalledWith(
        'user_profile:user-1',
        expect.any(String),
        'EX',
        3600,
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUserProfile('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateLastSeen()', () => {
    it('should update lastSeen and invalidate cache', async () => {
      prisma.user.update.mockResolvedValue(mockUser());
      await service.updateLastSeen('user-1');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { lastSeen: expect.any(Date) },
        }),
      );
      expect(redis.del).toHaveBeenCalledWith('user_profile:user-1');
    });
  });
});
