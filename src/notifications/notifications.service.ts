import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Server } from 'socket.io';
import { NotificationType } from './enums/notification-type.enum';

@Injectable()
export class NotificationsService {
  private io: Server;

  constructor(private readonly prisma: PrismaService) {}

  setServer(server: Server) {
    this.io = server;
  }

  async create(
    userId: string,
    actorId: string,
    type: NotificationType | string,
    referenceId?: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        actorId,
        type,
        referenceId,
      },
      include: {
        actor: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    if (this.io) {
      this.io.to(`user:${userId}`).emit('notification:new', notification);
    }

    return notification;
  }

  async getUserNotifications(userId: string, limit: number = 20) {
    return this.prisma.notification.findMany({
      where: { userId },
      include: {
        actor: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.update({
      where: {
        id: notificationId,
        userId: userId, // Ensure user owns the notification
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }
}
