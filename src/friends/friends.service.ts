import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestStatus } from './enums/friend-request-status.enum';
import { FriendRequestAction } from './dto/respond-friend-request.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { FriendRequest } from '@prisma/client';
import { PaginatedResponse } from '../common/types/response.types';
import {
  PendingRequestResponseDto,
  SendRequestResponseDto,
} from './dto/friend-response.dto';
import { SuccessMessageResponseDto } from '../common/dto/success-response.dto';
import { PublicUserProfileDto } from '../user/dto/user-response.dto';
import { RespondRequestResponseDto } from './dto/respond-request-response.dto';
import { BlockService } from '../block/block.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { CACHE_TTL } from '../common/constants/cache.constants';
import { PAGINATION } from '../common/constants/pagination.constants';
import { PresenceStatus } from '../common/enums/presence.enum';

const FRIENDS_CACHE_TTL = CACHE_TTL.FRIENDS;
const FRIENDS_CACHE_KEY = (accountId: string) => `friends_list:${accountId}`;

/** How long (ms) a PENDING request lives before it is considered expired */
const FRIEND_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Minimum wait time (ms) before re-sending after a REJECTION */
const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly blockService: BlockService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly socketEmitterService: SocketEmitterService,
  ) {}

  async sendRequest(
    senderId: string,
    receiverId: string,
  ): Promise<SendRequestResponseDto> {
    if (senderId === receiverId) {
      throw new BadRequestException(
        'You cannot send a friend request to yourself',
      );
    }

    const receiver = await this.prisma.account.findUnique({
      where: { id: receiverId },
    });
    if (!receiver) {
      throw new NotFoundException('Receiver account not found');
    }

    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { accountId1: senderId, accountId2: receiverId },
          { accountId1: receiverId, accountId2: senderId },
        ],
      },
    });
    if (existingFriendship) {
      throw new BadRequestException('You are already friends with this user');
    }

    // Block check in either direction
    // Intentionally vague message to protect privacy of the blocker
    const blocked = await this.blockService.isBlockedEitherDirection(
      senderId,
      receiverId,
    );
    if (blocked) {
      throw new ForbiddenException(
        'You cannot send a friend request to this user',
      );
    }

    // Check if a pending (non-expired) request exists in either direction
    const now = new Date();
    const existingPending = await this.prisma.friendRequest.findFirst({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
        // Only treat as pending if not yet expired
        AND: [
          {
            OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
          },
        ],
      },
    });

    if (existingPending) {
      // Cross-send — B sends to A while A's request to B is still PENDING
      // → auto-accept instead of throwing an error
      if (
        existingPending.senderId === receiverId &&
        existingPending.receiverId === senderId
      ) {
        return this.autoAccept(existingPending, senderId);
      }

      // A already has a PENDING request to B → block duplicate
      throw new BadRequestException(
        'A pending friend request already exists between you and this user',
      );
    }

    // Cooldown check — was sender's previous request rejected?
    const previousRequest = await this.prisma.friendRequest.findUnique({
      where: { senderId_receiverId: { senderId, receiverId } },
    });
    if (previousRequest?.status === FriendRequestStatus.REJECTED) {
      const elapsed = now.getTime() - previousRequest.updatedAt.getTime();
      if (elapsed < REJECTION_COOLDOWN_MS) {
        const remainingHours = Math.ceil(
          (REJECTION_COOLDOWN_MS - elapsed) / (60 * 60 * 1000),
        );
        throw new BadRequestException(
          `Please wait ${remainingHours} more hour(s) before sending another request`,
        );
      }
    }

    // Set expiredAt = now + 7 days
    const expiredAt = new Date(now.getTime() + FRIEND_REQUEST_TTL_MS);

    // Upsert: re-activate a previously rejected request, or create new
    const req = await this.prisma.friendRequest.upsert({
      where: {
        senderId_receiverId: { senderId, receiverId },
      },
      update: {
        status: FriendRequestStatus.PENDING,
        expiredAt,
      },
      create: {
        senderId,
        receiverId,
        status: FriendRequestStatus.PENDING,
        expiredAt,
      },
    });

    // Notify receiver
    await this.notificationsService.create(
      receiverId,
      senderId,
      NotificationType.FRIEND_REQUEST_RECEIVED,
      req.id,
    );

    this.socketEmitterService.emitToUser(senderId, 'friend:updated');
    this.socketEmitterService.emitToUser(receiverId, 'friend:updated');

    return { result: 'FRIEND_REQUEST_SENT', friendRequest: req };
  }

  /**
   * Auto-accept a cross-send scenario:
   * B sends a request to A while A already has a PENDING request to B.
   * We accept A's existing request on behalf of B.
   */
  private async autoAccept(
    existingRequest: FriendRequest,
    acceptorId: string,
  ): Promise<SendRequestResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.friendRequest.update({
        where: { id: existingRequest.id },
        data: { status: FriendRequestStatus.ACCEPTED },
      });

      const [uid1, uid2] = [
        existingRequest.senderId,
        existingRequest.receiverId,
      ].sort();
      await tx.friend.create({
        data: { accountId1: uid1, accountId2: uid2 },
      });

      return updatedRequest;
    });

    // Invalidate friends list cache for both users
    await Promise.all([
      this.redis.del(FRIENDS_CACHE_KEY(existingRequest.senderId)),
      this.redis.del(FRIENDS_CACHE_KEY(existingRequest.receiverId)),
    ]);

    // Notify the original sender that their request was accepted
    await this.notificationsService.create(
      existingRequest.senderId,
      acceptorId,
      NotificationType.FRIEND_REQUEST_ACCEPTED,
      existingRequest.id,
    );

    this.socketEmitterService.emitToUser(
      existingRequest.senderId,
      'friend:updated',
    );
    this.socketEmitterService.emitToUser(
      existingRequest.receiverId,
      'friend:updated',
    );

    return { result: 'AUTO_ACCEPTED', friendRequest: result };
  }

  async getPendingRequests(
    accountId: string,
  ): Promise<PendingRequestResponseDto[]> {
    const now = new Date();
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        OR: [{ receiverId: accountId }, { senderId: accountId }],
        status: FriendRequestStatus.PENDING,
        // Exclude expired requests from the results
        AND: [{ OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] }],
      },
      include: {
        sender: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                handle: true,
                avatarUrl: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                handle: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((req) => ({
      ...req,
      sender: {
        id: req.sender.id,
        handle: req.sender.profile?.handle || '',
        displayName: req.sender.profile?.displayName || null,
        avatarUrl: req.sender.profile?.avatarUrl || null,
      },
      receiver: {
        id: req.receiver.id,
        handle: req.receiver.profile?.handle || '',
        displayName: req.receiver.profile?.displayName || null,
        avatarUrl: req.receiver.profile?.avatarUrl || null,
      },
    }));
  }

  async respondToRequest(
    requestId: string,
    currentUserId: string,
    action: FriendRequestAction,
  ): Promise<RespondRequestResponseDto> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    // Only the receiver can accept or reject
    if (request.receiverId !== currentUserId) {
      throw new ForbiddenException(
        'You can only respond to friend requests sent to you',
      );
    }

    if (action === FriendRequestAction.REJECTED) {
      await this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendRequestStatus.REJECTED },
      });
      this.socketEmitterService.emitToUser(request.senderId, 'friend:updated');
      this.socketEmitterService.emitToUser(
        request.receiverId,
        'friend:updated',
      );
      return { success: true, action: 'rejected', requestId };
    }

    // ACCEPTED — use a transaction to ensure atomicity
    await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendRequestStatus.ACCEPTED },
      });

      // Store IDs in consistent order for easier querying
      const [uid1, uid2] = [request.senderId, request.receiverId].sort();

      await tx.friend.create({
        data: { accountId1: uid1, accountId2: uid2 },
      });

      return updatedRequest;
    });

    // Invalidate friends list cache for both users
    await Promise.all([
      this.redis.del(FRIENDS_CACHE_KEY(request.senderId)),
      this.redis.del(FRIENDS_CACHE_KEY(request.receiverId)),
    ]);

    // Notify sender that their request was accepted
    await this.notificationsService.create(
      request.senderId,
      currentUserId,
      NotificationType.FRIEND_REQUEST_ACCEPTED,
      request.id,
    );

    this.socketEmitterService.emitToUser(request.senderId, 'friend:updated');
    this.socketEmitterService.emitToUser(request.receiverId, 'friend:updated');

    return { success: true, action: 'accepted', requestId };
  }

  async getFriends(
    accountId: string,
    limit: number = PAGINATION.DEFAULT_TAKE,
    offset: number = PAGINATION.DEFAULT_SKIP,
  ): Promise<PaginatedResponse<PublicUserProfileDto>> {
    const isFirstPage =
      offset === PAGINATION.DEFAULT_SKIP && limit === PAGINATION.DEFAULT_TAKE;
    let result: {
      data: any[];
      total: number;
      limit: number;
      offset: number;
    } | null = null;

    // 1. Try to get basic friends list from cache
    if (isFirstPage) {
      const cached = await this.redis.get(FRIENDS_CACHE_KEY(accountId));
      if (cached) {
        result = JSON.parse(cached);
      }
    }

    // 2. If not in cache, query from Database
    if (!result) {
      const where = {
        OR: [{ accountId1: accountId }, { accountId2: accountId }],
      };

      const [friendships, total] = await Promise.all([
        this.prisma.friend.findMany({
          where,
          include: {
            account1: {
              select: {
                id: true,
                lastSeen: true,
                profile: {
                  select: { handle: true, displayName: true, avatarUrl: true },
                },
              },
            },
            account2: {
              select: {
                id: true,
                lastSeen: true,
                profile: {
                  select: { handle: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.friend.count({ where }),
      ]);

      const data = friendships.map((f) => {
        const acc = f.accountId1 === accountId ? f.account2 : f.account1;
        return {
          id: acc.id,
          handle: acc.profile?.handle || '',
          displayName: acc.profile?.displayName || null,
          avatarUrl: acc.profile?.avatarUrl || null,
          lastSeen: acc.lastSeen,
        };
      });

      result = { data, total, limit, offset };

      // Cache the raw data (WITHOUT isOnline status)
      if (isFirstPage) {
        await this.redis.set(
          FRIENDS_CACHE_KEY(accountId),
          JSON.stringify(result),
          'EX',
          FRIENDS_CACHE_TTL,
        );
      }
    }

    // 3. Attach real-time isOnline status from Redis
    if (result.data.length > 0) {
      const keys = result.data.map((account) => `presence:${account.id}`);
      const presences = await this.redis.mget(keys);

      result.data = result.data.map((account, idx) => ({
        ...account,
        isOnline: presences[idx] === PresenceStatus.ONLINE,
      }));
    }

    return result;
  }

  /**
   * Returns friend IDs in pages to avoid loading thousands of records into memory.
   * Used internally by ChatGateway for presence broadcasting.
   * Callers iterate pages until an empty array is returned.
   */
  async getFriendIdsBatch(
    accountId: string,
    skip: number,
    take: number = 100,
  ): Promise<string[]> {
    const friendships = await this.prisma.friend.findMany({
      where: {
        OR: [{ accountId1: accountId }, { accountId2: accountId }],
      },
      select: { accountId1: true, accountId2: true },
      skip,
      take,
    });

    return friendships.map((f) =>
      f.accountId1 === accountId ? f.accountId2 : f.accountId1,
    );
  }

  async cancelRequest(
    requestId: string,
    currentUserId: string,
  ): Promise<SuccessMessageResponseDto> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    // Only the sender can cancel their own request
    if (request.senderId !== currentUserId) {
      throw new ForbiddenException(
        'You can only cancel friend requests that you sent',
      );
    }

    await this.prisma.friendRequest.delete({ where: { id: requestId } });

    this.socketEmitterService.emitToUser(request.senderId, 'friend:updated');
    this.socketEmitterService.emitToUser(request.receiverId, 'friend:updated');

    return { success: true, message: 'Friend request cancelled' };
  }

  async removeFriend(
    accountId: string,
    targetFriendId: string,
  ): Promise<SuccessMessageResponseDto> {
    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { accountId1: accountId, accountId2: targetFriendId },
          { accountId1: targetFriendId, accountId2: accountId },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    // Delete Friend record AND all FriendRequest records between the two
    // users in a single transaction. This prevents the upsert bug where a stale
    // ACCEPTED request could be reused without going through the proper flow.
    await this.prisma.$transaction([
      this.prisma.friend.delete({ where: { id: friendship.id } }),
      this.prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: accountId, receiverId: targetFriendId },
            { senderId: targetFriendId, receiverId: accountId },
          ],
        },
      }),
    ]);

    // Invalidate friends list cache for both users
    await Promise.all([
      this.redis.del(FRIENDS_CACHE_KEY(accountId)),
      this.redis.del(FRIENDS_CACHE_KEY(targetFriendId)),
    ]);

    this.socketEmitterService.emitToUser(accountId, 'friend:updated');
    this.socketEmitterService.emitToUser(targetFriendId, 'friend:updated');

    return { success: true, message: 'Friend removed successfully' };
  }

  /**
   * Daily cron job to delete PENDING requests that have exceeded
   * their 7-day TTL. Runs every day at 02:00 server time.
   */
  @Cron('0 2 * * *')
  async cleanupExpiredRequests(): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.friendRequest.deleteMany({
      where: {
        status: FriendRequestStatus.PENDING,
        expiredAt: { lte: now },
      },
    });
    this.logger.log(`Cron: cleaned up ${count} expired friend request(s)`);
  }
}
