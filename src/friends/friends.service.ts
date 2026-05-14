import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestStatus } from './enums/friend-request-status.enum';
import { FriendRequestAction } from './dto/respond-friend-request.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';

@Injectable()
export class FriendsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException('You cannot send a friend request to yourself');
    }

    // Check if receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
    });
    if (!receiver) {
      throw new NotFoundException('Receiver user not found');
    }

    // Check if already friends (bidirectional)
    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { userId1: senderId, userId2: receiverId },
          { userId1: receiverId, userId2: senderId },
        ],
      },
    });
    if (existingFriendship) {
      throw new BadRequestException('You are already friends with this user');
    }

    // Check if a pending request already exists in either direction
    const existingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        status: FriendRequestStatus.PENDING,
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });
    if (existingRequest) {
      throw new BadRequestException(
        'A pending friend request already exists between you and this user',
      );
    }

    // Upsert: re-activate a previously rejected request, or create new
    const req = await this.prisma.friendRequest.upsert({
      where: {
        senderId_receiverId: { senderId, receiverId },
      },
      update: {
        status: FriendRequestStatus.PENDING,
      },
      create: {
        senderId,
        receiverId,
        status: FriendRequestStatus.PENDING,
      },
    });

    // Notify receiver
    await this.notificationsService.create(
      receiverId,
      senderId,
      NotificationType.FRIEND_REQUEST_RECEIVED,
      req.id,
    );

    return req;
  }

  async getPendingRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: FriendRequestStatus.PENDING,
      },
      include: {
        sender: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondToRequest(
    requestId: string,
    currentUserId: string,
    action: FriendRequestAction,
  ) {
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
      throw new ForbiddenException('You can only respond to friend requests sent to you');
    }

    if (action === FriendRequestAction.REJECTED) {
      return this.prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendRequestStatus.REJECTED },
      });
    }

    // ACCEPTED — use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.friendRequest.update({
        where: { id: requestId },
        data: { status: FriendRequestStatus.ACCEPTED },
      });

      // Store IDs in consistent order for easier querying
      const [uid1, uid2] = [request.senderId, request.receiverId].sort();

      await tx.friend.create({
        data: { userId1: uid1, userId2: uid2 },
      });

      return updatedRequest;
    });

    // Notify sender that their request was accepted
    await this.notificationsService.create(
      request.senderId,
      currentUserId,
      NotificationType.FRIEND_REQUEST_ACCEPTED,
      request.id,
    );

    return result;
  }

  async getFriends(userId: string, limit: number = 20, offset: number = 0) {
    const where = {
      OR: [{ userId1: userId }, { userId2: userId }],
    };

    const [friendships, total] = await Promise.all([
      this.prisma.friend.findMany({
        where,
        include: {
          user1: {
            select: { id: true, username: true, avatarUrl: true, lastSeen: true },
          },
          user2: {
            select: { id: true, username: true, avatarUrl: true, lastSeen: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.friend.count({ where }),
    ]);

    // Return only the OTHER user in each friendship
    const data = friendships.map((f) => (f.userId1 === userId ? f.user2 : f.user1));

    return { data, total, limit, offset };
  }

  /**
   * Returns ALL friends as a flat array (no pagination).
   * Used internally by ChatGateway for presence broadcasting.
   */
  async getAllFriends(userId: string) {
    const friendships = await this.prisma.friend.findMany({
      where: {
        OR: [{ userId1: userId }, { userId2: userId }],
      },
      include: {
        user1: {
          select: { id: true, username: true, avatarUrl: true },
        },
        user2: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    return friendships.map((f) => (f.userId1 === userId ? f.user2 : f.user1));
  }

  async removeFriend(userId: string, targetFriendId: string) {
    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          { userId1: userId, userId2: targetFriendId },
          { userId1: targetFriendId, userId2: userId },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.prisma.friend.delete({
      where: { id: friendship.id },
    });

    return { success: true, message: 'Friend removed successfully' };
  }
}
