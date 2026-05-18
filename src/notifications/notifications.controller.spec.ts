import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getUserNotifications: jest.fn(),
      getUnreadCount: jest.fn(),
      markAllAsRead: jest.fn(),
      markAsRead: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();
    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('getUserNotifications() should pass user.id and parsed limit', async () => {
    service.getUserNotifications.mockResolvedValue([]);
    await controller.getUserNotifications({ id: 'u1' }, '10');
    expect(service.getUserNotifications).toHaveBeenCalledWith('u1', 10);
  });

  it('getUserNotifications() should use default limit 20 when not provided', async () => {
    service.getUserNotifications.mockResolvedValue([]);
    await controller.getUserNotifications({ id: 'u1' });
    expect(service.getUserNotifications).toHaveBeenCalledWith('u1', 20);
  });

  it('getUnreadCount() should pass user.id', async () => {
    service.getUnreadCount.mockResolvedValue({ count: 3 });
    const result = await controller.getUnreadCount({ id: 'u1' });
    expect(service.getUnreadCount).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ count: 3 });
  });

  it('markAllAsRead() should pass user.id', async () => {
    service.markAllAsRead.mockResolvedValue({ count: 5 });
    await controller.markAllAsRead({ id: 'u1' });
    expect(service.markAllAsRead).toHaveBeenCalledWith('u1');
  });

  it('markAsRead() should pass notification id and user.id', async () => {
    service.markAsRead.mockResolvedValue({});
    await controller.markAsRead({ id: 'u1' }, 'n1');
    expect(service.markAsRead).toHaveBeenCalledWith('n1', 'u1');
  });
});
