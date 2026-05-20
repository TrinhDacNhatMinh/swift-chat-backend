import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_KEYS } from '../common/constants/cache.constants';

const USER_PROFILE_CACHE_KEY = CACHE_KEYS.USER_PROFILE;
import {
  BlockResponseDto,
  BlockedUserResponseDto,
  BlockStatusResponseDto,
} from './dto/block-response.dto';
import { FriendRequestStatus } from '../friends/enums/friend-request-status.enum';

@Injectable()
export class BlockService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Check whether `blockerId` has blocked `blockedId` (one-directional).
   */
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const record = await this.prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    return record !== null;
  }

  /**
   * Check whether either account has blocked the other (bidirectional).
   * Used to guard sendFriendRequest — no direction distinction is revealed to caller.
   */
  async isBlockedEitherDirection(
    userA: string,
    userB: string,
  ): Promise<boolean> {
    const record = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
    });
    return record !== null;
  }

  /**
   * Block a user.
   * - If a PENDING friend request exists in either direction → delete it.
   * - If they are already friends → remove the friendship as well.
   */
  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<BlockResponseDto> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    // Ensure the target account exists
    const target = await this.prisma.account.findUnique({
      where: { id: blockedId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    // Idempotency guard
    const alreadyBlocked = await this.isBlocked(blockerId, blockedId);
    if (alreadyBlocked) {
      throw new ConflictException('You have already blocked this user');
    }

    // Transaction: block + cleanup
    await this.prisma.$transaction(async (tx) => {
      // 1. Create Block record
      await tx.block.create({ data: { blockerId, blockedId } });

      // 2. Delete any PENDING request between the two users (either direction)
      await tx.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: blockerId, receiverId: blockedId },
            { senderId: blockedId, receiverId: blockerId },
          ],
          status: FriendRequestStatus.PENDING,
        },
      });

      // 3. Remove friendship if it exists (either direction)
      await tx.friend.deleteMany({
        where: {
          OR: [
            { accountId1: blockerId, accountId2: blockedId },
            { accountId1: blockedId, accountId2: blockerId },
          ],
        },
      });
    });

    await this.redis.del(USER_PROFILE_CACHE_KEY(blockerId));
    await this.redis.del(USER_PROFILE_CACHE_KEY(blockedId));

    return { success: true, blocked: true, targetUserId: blockedId };
  }

  /**
   * Unblock a user.
   */
  async unblockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<BlockResponseDto> {
    const result = await this.prisma.block.deleteMany({
      where: { blockerId, blockedId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Block record not found');
    }

    await this.redis.del(USER_PROFILE_CACHE_KEY(blockerId));
    await this.redis.del(USER_PROFILE_CACHE_KEY(blockedId));

    return { success: true, blocked: false, targetUserId: blockedId };
  }

  /**
   * Get the list of users blocked by `accountId`.
   */
  async getBlockedUsers(accountId: string): Promise<BlockedUserResponseDto[]> {
    const blocks = await this.prisma.block.findMany({
      where: { blockerId: accountId },
      include: {
        blocked: {
          select: {
            id: true,
            profile: {
              select: { avatarUrl: true, handle: true, displayName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return blocks.map((b) => ({
      id: b.blocked.id,
      handle: b.blocked.profile?.handle || '',
      displayName: b.blocked.profile?.displayName || null,
      avatarUrl: b.blocked.profile?.avatarUrl || null,
      blockedAt: b.createdAt,
    }));
  }

  /**
   * Get block status between two users.
   */
  async getBlockStatus(
    accountId: string,
    targetId: string,
  ): Promise<BlockStatusResponseDto> {
    const [isBlocker, isBlocked] = await Promise.all([
      this.isBlocked(accountId, targetId),
      this.isBlocked(targetId, accountId),
    ]);
    return { isBlocker, isBlocked };
  }
}
