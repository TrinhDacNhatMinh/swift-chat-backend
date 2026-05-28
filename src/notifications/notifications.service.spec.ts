import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let socketEmitter: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    socketEmitter = {
      emitToUser: jest.fn(),
      emitToRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SocketEmitterService, useValue: socketEmitter },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // create()

  describe('create()', () => {
    const notification = {
      id: 'n1',
      accountId: 'u1',
      actorId: 'u2',
      type: NotificationType.FRIEND_REQUEST_RECEIVED,
      referenceId: 'ref1',
      isRead: false,
      createdAt: new Date(),
      actor: {
        id: 'u2',
        username: 'actor',
        profile: { avatarUrl: null, displayName: null },
      },
    };

    it('should create notification and emit via socket when server is set in create()', async () => {
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create(
        'u1',
        'u2',
        NotificationType.FRIEND_REQUEST_RECEIVED,
        'ref1',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          accountId: 'u1',
          actorId: 'u2',
          type: NotificationType.FRIEND_REQUEST_RECEIVED,
          referenceId: 'ref1',
        },
        include: {
          actor: {
            select: {
              id: true,
              profile: {
                select: { avatarUrl: true, displayName: true, handle: true },
              },
            },
          },
        },
      });
      expect(socketEmitter.emitToUser).toHaveBeenCalledWith(
        'u1',
        'notification:new',
        expect.objectContaining({
          id: 'n1',
          actor: expect.objectContaining({
            id: 'u2',
            handle: '',
            avatarUrl: null,
            displayName: null,
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: 'n1',
          actor: expect.objectContaining({
            id: 'u2',
            avatarUrl: null,
            displayName: null,
          }),
        }),
      );
    });

    it('should create notification without emitting when server is not set in create()', async () => {
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create(
        'u1',
        'u2',
        NotificationType.FRIEND_REQUEST_RECEIVED,
      );

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(result).toEqual({
        id: notification.id,
        type: notification.type,
        referenceId: notification.referenceId,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
        actor: {
          id: 'u2',
          handle: '',
          displayName: null,
          avatarUrl: null,
        },
      });
      // No error thrown even without server
    });
  });

  // getUserNotifications()

  describe('getUserNotifications()', () => {
    it('should return notifications ordered by createdAt desc when getUserNotifications() is called', async () => {
      const notifications = [
        {
          id: 'n1',
          createdAt: new Date(),
          isRead: false,
          type: 'some_type',
          referenceId: 'ref1',
          actor: {
            id: 'u2',
            profile: { handle: 'actor', avatarUrl: null, displayName: null },
          },
        },
        {
          id: 'n2',
          createdAt: new Date(),
          isRead: true,
          type: 'another_type',
          referenceId: 'ref2',
          actor: {
            id: 'u3',
            profile: { handle: 'actor2', avatarUrl: null, displayName: null },
          },
        },
      ];
      prisma.notification.findMany.mockResolvedValue(notifications);

      const result = await service.getUserNotifications('u1', 10);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: 'u1' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      );
      expect(result).toEqual(
        notifications.map((n) => ({
          ...n,
          isRead: n.isRead,
          createdAt: n.createdAt,
          actor: {
            id: n.actor.id,
            handle: n.actor.profile.handle,
            displayName: n.actor.profile.displayName,
            avatarUrl: n.actor.profile.avatarUrl,
          },
        })),
      );
    });
  });

  // markAsRead()

  describe('markAsRead()', () => {
    it('should update isRead for owned notification when markAsRead() is called', async () => {
      prisma.notification.update.mockResolvedValue({ id: 'n1', isRead: true });

      await service.markAsRead('n1', 'u1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1', accountId: 'u1' },
        data: { isRead: true },
      });
    });
  });

  // markAllAsRead()

  describe('markAllAsRead()', () => {
    it('should mark all unread notifications as read when markAllAsRead() is called', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllAsRead('u1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { accountId: 'u1', isRead: false },
        data: { isRead: true },
      });
    });
  });

  // getUnreadCount()

  describe('getUnreadCount()', () => {
    it('should return count of unread notifications when getUnreadCount() is called', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount('u1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { accountId: 'u1', isRead: false },
      });
      expect(result).toEqual({ count: 3 });
    });
  });
});
