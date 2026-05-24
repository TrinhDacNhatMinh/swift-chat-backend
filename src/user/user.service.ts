import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const USER_PROFILE_CACHE_TTL = 3600; // 1 hour
const USER_PROFILE_CACHE_KEY = (id: string) => `user_profile:${id}`;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(data: {
    email: string;
    username: string;
    passwordHash?: string;
    authProvider: string;
    providerId?: string;
    avatarUrl?: string;
  }) {
    return this.prisma.user.create({
      data,
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByProvider(authProvider: string, providerId: string) {
    return this.prisma.user.findUnique({
      where: {
        authProvider_providerId: {
          authProvider,
          providerId,
        },
      },
    });
  }

  async updateProfile(id: string, data: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    // Invalidate stale cache so next read fetches fresh data
    await this.redis.del(USER_PROFILE_CACHE_KEY(id));

    return updated;
  }

  async searchUsers(query: string, currentUserId: string) {
    return this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
      },
      take: 20,
    });
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeen: new Date() },
    });

    // lastSeen changes on every disconnect — invalidate so profile reflects accurate time
    await this.redis.del(USER_PROFILE_CACHE_KEY(userId));
  }

  async getUserProfile(id: string) {
    // Cache-aside: return cached value if available
    const cached = await this.redis.get(USER_PROFILE_CACHE_KEY(id));
    if (cached) {
      return JSON.parse(cached) as {
        id: string;
        username: string;
        avatarUrl: string | null;
        createdAt: string | Date;
        lastSeen: string | Date | null;
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        createdAt: true,
        lastSeen: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.redis.set(
      USER_PROFILE_CACHE_KEY(id),
      JSON.stringify(user),
      'EX',
      USER_PROFILE_CACHE_TTL,
    );

    return user;
  }
}
