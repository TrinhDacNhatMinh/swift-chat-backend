import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { NotificationType, Notification } from '@prisma/client';
import { CountResponse } from '../common/types/response.types';
import { NotificationResponseDto } from './dto/notification-response.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketEmitterService: SocketEmitterService,
  ) {}

  /**
   * Map raw Prisma notification row (with nested actor.profile) to the public DTO shape.
   */
  private mapNotification(notification: any): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      referenceId: notification.referenceId,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      actor: {
        id: notification.actor.id,
        handle: notification.actor.profile?.handle || '',
        displayName: notification.actor.profile?.displayName || null,
        avatarUrl: notification.actor.profile?.avatarUrl || null,
      },
    };
  }

  /**
   * Create a notification record and emit it in real-time via WebSocket.
   */
  async create(
    accountId: string,
    actorId: string,
    type: NotificationType,
    referenceId?: string,
  ): Promise<NotificationResponseDto> {
    const rawNotification = await this.prisma.notification.create({
      data: {
        accountId,
        actorId,
        type,
        referenceId,
      },
      include: {
        actor: {
          select: {
            id: true,
            profile: {
              select: { displayName: true, avatarUrl: true, handle: true },
            },
          },
        },
      },
    });

    const notification = this.mapNotification(rawNotification);

    this.socketEmitterService.emitToUser(
      accountId,
      'notification:new',
      notification,
    );

    return notification;
  }

  async getUserNotifications(
    accountId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<NotificationResponseDto[]> {
    const rawNotifications = await this.prisma.notification.findMany({
      where: { accountId },
      include: {
        actor: {
          select: {
            id: true,
            profile: {
              select: { displayName: true, avatarUrl: true, handle: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return rawNotifications.map((n) => this.mapNotification(n));
  }

  /**
   * Mark a single notification as read. Scoped to `accountId` to prevent
   * one user from marking another user's notifications.
   * @throws {NotFoundException} if the notification does not exist or does not belong to the account
   */
  async markAsRead(
    notificationId: string,
    accountId: string,
  ): Promise<Notification> {
    try {
      return await this.prisma.notification.update({
        where: {
          id: notificationId,
          accountId: accountId,
        },
        data: { isRead: true },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2025') {
        throw new NotFoundException('Notification not found');
      }
      throw error;
    }
  }

  /**
   * Marks all unread notifications for the account as read.
   * Returns the count of updated records.
   */
  async markAllAsRead(accountId: string): Promise<CountResponse> {
    return await this.prisma.notification.updateMany({
      where: { accountId, isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Returns the number of unread notifications for the account.
   */
  async getUnreadCount(accountId: string): Promise<CountResponse> {
    const count = await this.prisma.notification.count({
      where: { accountId, isRead: false },
    });
    return { count };
  }
}
