import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestStatus } from './enums/friend-request-status.enum';
import { FriendRequestAction } from './dto/respond-friend-request.dto';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.friendRequest.upsert({
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
    return this.prisma.$transaction(async (tx) => {
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
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friend.findMany({
      where: {
        OR: [{ userId1: userId }, { userId2: userId }],
      },
      include: {
        user1: {
          select: { id: true, username: true, avatarUrl: true, lastSeen: true },
        },
        user2: {
          select: { id: true, username: true, avatarUrl: true, lastSeen: true },
        },
      },
    });

    // Return only the OTHER user in each friendship
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
