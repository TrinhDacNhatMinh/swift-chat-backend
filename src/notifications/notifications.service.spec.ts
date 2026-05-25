import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from './enums/notification-type.enum';
import { createMockPrismaService } from '../__mocks__/prisma.mock';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // create()
  // =========================================================================
  describe('create()', () => {
    const notification = {
      id: 'n1',
      userId: 'u1',
      actorId: 'u2',
      type: NotificationType.FRIEND_REQUEST_RECEIVED,
      referenceId: 'ref1',
      isRead: false,
      actor: { id: 'u2', username: 'actor', avatarUrl: null },
    };

    it('should create notification and emit via socket when server is set in create()', async () => {
      prisma.notification.create.mockResolvedValue(notification);
      const mockEmit = jest.fn();
      const mockServer = {
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
      } as any;
      service.setServer(mockServer);

      const result = await service.create(
        'u1',
        'u2',
        NotificationType.FRIEND_REQUEST_RECEIVED,
        'ref1',
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          actorId: 'u2',
          type: NotificationType.FRIEND_REQUEST_RECEIVED,
          referenceId: 'ref1',
        },
        include: {
          actor: { select: { id: true, username: true, avatarUrl: true } },
        },
      });
      expect(mockServer.to).toHaveBeenCalledWith('user:u1');
      expect(mockEmit).toHaveBeenCalledWith('notification:new', notification);
      expect(result).toEqual(notification);
    });

    it('should create notification without emitting when server is not set in create()', async () => {
      prisma.notification.create.mockResolvedValue(notification);

      const result = await service.create(
        'u1',
        'u2',
        NotificationType.FRIEND_REQUEST_RECEIVED,
      );

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(result).toEqual(notification);
      // No error thrown even without server
    });
  });

  // =========================================================================
  // getUserNotifications()
  // =========================================================================
  describe('getUserNotifications()', () => {
    it('should return notifications ordered by createdAt desc when getUserNotifications() is called', async () => {
      const notifications = [{ id: 'n1' }, { id: 'n2' }];
      prisma.notification.findMany.mockResolvedValue(notifications);

      const result = await service.getUserNotifications('u1', 10);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      );
      expect(result).toEqual(notifications);
    });
  });

  // =========================================================================
  // markAsRead()
  // =========================================================================
  describe('markAsRead()', () => {
    it('should update isRead for owned notification when markAsRead() is called', async () => {
      prisma.notification.update.mockResolvedValue({ id: 'n1', isRead: true });

      await service.markAsRead('n1', 'u1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        data: { isRead: true },
      });
    });
  });

  // =========================================================================
  // markAllAsRead()
  // =========================================================================
  describe('markAllAsRead()', () => {
    it('should mark all unread notifications as read when markAllAsRead() is called', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllAsRead('u1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', isRead: false },
        data: { isRead: true },
      });
    });
  });

  // =========================================================================
  // getUnreadCount()
  // =========================================================================
  describe('getUnreadCount()', () => {
    it('should return count of unread notifications when getUnreadCount() is called', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount('u1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'u1', isRead: false },
      });
      expect(result).toEqual({ count: 3 });
    });
  });
});
