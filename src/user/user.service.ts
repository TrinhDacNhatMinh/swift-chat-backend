import {
  Injectable,
  NotFoundException,
  Inject,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Account, Profile, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { SuccessMessageResponse } from '../common/types/response.types';
import { UserResponseDto } from './dto/user-response.dto';
import { SearchUserResponseDto } from './dto/user-response.dto';
import { CACHE_TTL, CACHE_KEYS } from '../common/constants/cache.constants';
import { PAGINATION } from '../common/constants/pagination.constants';
import { FriendRequestStatus } from '../friends/enums/friend-request-status.enum';

const USER_PROFILE_CACHE_TTL = CACHE_TTL.USER_PROFILE;
const USER_PROFILE_CACHE_KEY = CACHE_KEYS.USER_PROFILE;

type AccountWithProfile = Account & { profile: Profile | null };

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Create a new account with a linked Profile.
   * Auto-generates a unique `handle` (e.g. `account3f8a...`) if none is provided.
   */
  async create(
    data: {
      email: string;
      username: string;
      handle?: string;
      displayName?: string;
      passwordHash?: string;
      avatarUrl?: string;
      isEmailVerified?: boolean;
      authProviders?: { provider: string; providerUserId?: string }[];
    },
    tx?: Prisma.TransactionClient,
  ): Promise<AccountWithProfile> {
    const db = tx || this.prisma;
    let handle = data.handle;

    if (!handle) {
      let isUnique = false;
      while (!isUnique) {
        handle = `account${crypto.randomBytes(4).toString('hex')}`;
        const existing = await db.profile.findUnique({
          where: { handle },
        });
        if (!existing) {
          isUnique = true;
        }
      }
    }

    return await db.account.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash: data.passwordHash,
        isEmailVerified: data.isEmailVerified,
        profile: {
          create: {
            handle: handle!,
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
          },
        },
        ...(data.authProviders && data.authProviders.length > 0
          ? {
              authProviders: {
                create: data.authProviders,
              },
            }
          : {}),
      },
      include: { profile: true },
    });
  }

  async findByEmail(email: string): Promise<AccountWithProfile | null> {
    return await this.prisma.account.findUnique({
      where: { email },
      include: { profile: true },
    });
  }

  async findByUsername(username: string): Promise<AccountWithProfile | null> {
    return await this.prisma.account.findUnique({
      where: { username },
      include: { profile: true },
    });
  }

  async findById(id: string): Promise<AccountWithProfile> {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!account) {
      throw new NotFoundException('User not found');
    }
    return account;
  }

  async findByProvider(
    provider: string,
    providerUserId: string,
  ): Promise<AccountWithProfile | null> {
    const authProvider = await this.prisma.authProvider.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: {
        account: {
          include: { profile: true },
        },
      },
    });
    return authProvider?.account || null;
  }

  async updateProfile(
    id: string,
    data: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const updated = await this.prisma.profile.update({
      where: { accountId: id },
      data,
      include: { account: true },
    });

    await this.redis.del(USER_PROFILE_CACHE_KEY(id));

    return this.mapToProfileResponse(updated.account, updated);
  }

  /**
   * Search users by handle or displayName.
   * When `scope === 'friends'`, only the caller's friend list is searched.
   * For global search, also attaches friendship and pending request status for each result.
   */
  async searchByHandle(
    q: string,
    scope: 'all' | 'friends',
    currentUserId: string,
  ): Promise<SearchUserResponseDto[]> {
    let profiles: Profile[] = [];

    if (scope === 'friends') {
      const friendships = await this.prisma.friend.findMany({
        where: {
          OR: [{ accountId1: currentUserId }, { accountId2: currentUserId }],
        },
      });
      const friendIds = friendships.map((f) =>
        f.accountId1 === currentUserId ? f.accountId2 : f.accountId1,
      );

      profiles = await this.prisma.profile.findMany({
        where: {
          accountId: { in: friendIds },
          OR: [
            { handle: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: PAGINATION.DEFAULT_TAKE,
      });

      return profiles.map((p) => ({
        id: p.accountId,
        handle: p.handle,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        isFriend: true,
        friendRequestStatus: null,
      }));
    }

    profiles = await this.prisma.profile.findMany({
      where: {
        accountId: { not: currentUserId },
        OR: [
          { handle: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: PAGINATION.DEFAULT_TAKE,
    });

    if (profiles.length === 0) return [];

    const userIds = profiles.map((p) => p.accountId);

    const [friendships, friendRequests] = await Promise.all([
      this.prisma.friend.findMany({
        where: {
          OR: [
            { accountId1: currentUserId, accountId2: { in: userIds } },
            { accountId1: { in: userIds }, accountId2: currentUserId },
          ],
        },
      }),
      this.prisma.friendRequest.findMany({
        where: {
          OR: [
            {
              senderId: currentUserId,
              receiverId: { in: userIds },
              status: FriendRequestStatus.PENDING,
            },
            {
              senderId: { in: userIds },
              receiverId: currentUserId,
              status: FriendRequestStatus.PENDING,
            },
          ],
        },
      }),
    ]);

    const friendSet = new Set(
      friendships.map((f) =>
        f.accountId1 === currentUserId ? f.accountId2 : f.accountId1,
      ),
    );

    const requestMap = new Map();
    friendRequests.forEach((req) => {
      if (req.senderId === currentUserId) {
        requestMap.set(req.receiverId, 'sent');
      } else {
        requestMap.set(req.senderId, 'received');
      }
    });

    return profiles.map((p) => ({
      id: p.accountId,
      handle: p.handle,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      isFriend: friendSet.has(p.accountId),
      friendRequestStatus: requestMap.get(p.accountId) || null,
    }));
  }

  /**
   * Update `lastSeen` timestamp and bust the profile cache so the next
   * read reflects the updated presence time.
   */
  async updateLastSeen(accountId: string): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { lastSeen: new Date() },
    });

    await this.redis.del(USER_PROFILE_CACHE_KEY(accountId));
  }

  /**
   * Fetch the caller's own full profile, using Redis as a read-through cache.
   */
  async getUserProfile(id: string): Promise<UserResponseDto> {
    const cached = await this.redis.get(USER_PROFILE_CACHE_KEY(id));
    if (cached) {
      return JSON.parse(cached) as UserResponseDto;
    }

    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { profile: true },
    });

    if (!account || !account.profile) {
      throw new NotFoundException('User not found');
    }

    const response = this.mapToProfileResponse(account, account.profile);
    await this.redis.set(
      USER_PROFILE_CACHE_KEY(id),
      JSON.stringify(response),
      'EX',
      USER_PROFILE_CACHE_TTL,
    );

    return response;
  }

  /**
   * Look up a public profile by handle. Not cached — handle lookups are less frequent
   * and the account id is unknown here, making cache invalidation complex.
   */
  async getUserProfileByHandle(handle: string): Promise<UserResponseDto> {
    const profile = await this.prisma.profile.findUnique({
      where: { handle },
      include: { account: true },
    });

    if (!profile || !profile.account) {
      throw new NotFoundException('User not found');
    }

    return this.mapToProfileResponse(profile.account, profile);
  }

  private mapToProfileResponse(
    account: Account,
    profile: Profile,
  ): UserResponseDto {
    return {
      id: account.id,
      username: account.username,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      bio: profile.bio,
      email: account.email,
      isEmailVerified: account.isEmailVerified,
      createdAt: account.createdAt,
      lastSeen: account.lastSeen,
    };
  }

  /**
   * Change the current user's password.
   * Invalidates all existing refresh tokens to force re-authentication on other devices.
   * @throws {BadRequestException} if the account uses Google-only login or current password is wrong
   */
  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<SuccessMessageResponse> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { authProviders: true },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    const hasPasswordProvider = account.authProviders.some(
      (p) => p.provider === 'password',
    );

    if (!hasPasswordProvider) {
      throw new BadRequestException(
        'Cannot change password for accounts without a password login',
      );
    }

    if (!account.passwordHash) {
      throw new BadRequestException('Account has no password set');
    }

    const isMatch = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid current password');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { passwordHash: newHash },
      }),
      this.prisma.refreshToken.deleteMany({ where: { accountId } }),
    ]);

    await this.redis.del(USER_PROFILE_CACHE_KEY(accountId));

    return { success: true, message: 'Password changed successfully' };
  }
}
