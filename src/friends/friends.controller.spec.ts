import { Test, TestingModule } from '@nestjs/testing';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

describe('FriendsController', () => {
  let controller: FriendsController;
  let friendsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    friendsService = {
      sendRequest: jest.fn(),
      getPendingRequests: jest.fn(),
      respondToRequest: jest.fn(),
      getFriends: jest.fn(),
      removeFriend: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FriendsController],
      providers: [{ provide: FriendsService, useValue: friendsService }],
    }).compile();
    controller = module.get<FriendsController>(FriendsController);
  });

  it('sendRequest() should pass user.id and receiverId', async () => {
    friendsService.sendRequest.mockResolvedValue({ id: 'r1' });
    await controller.sendRequest({ id: 'u1' }, { receiverId: 'u2' });
    expect(friendsService.sendRequest).toHaveBeenCalledWith('u1', 'u2');
  });

  it('getPendingRequests() should pass user.id', async () => {
    friendsService.getPendingRequests.mockResolvedValue([]);
    await controller.getPendingRequests({ id: 'u1' });
    expect(friendsService.getPendingRequests).toHaveBeenCalledWith('u1');
  });

  it('respondToRequest() should pass requestId, user.id, and action', async () => {
    friendsService.respondToRequest.mockResolvedValue({});
    await controller.respondToRequest({ id: 'u1' }, 'req1', {
      action: 'accepted' as any,
    });
    expect(friendsService.respondToRequest).toHaveBeenCalledWith(
      'req1',
      'u1',
      'accepted',
    );
  });

  it('getFriends() should pass user.id, limit, and offset', async () => {
    friendsService.getFriends.mockResolvedValue({ data: [], total: 0 });
    await controller.getFriends({ id: 'u1' }, { limit: 10, offset: 5 });
    expect(friendsService.getFriends).toHaveBeenCalledWith('u1', 10, 5);
  });

  it('removeFriend() should pass user.id and target userId', async () => {
    friendsService.removeFriend.mockResolvedValue({ success: true });
    await controller.removeFriend({ id: 'u1' }, 'u2');
    expect(friendsService.removeFriend).toHaveBeenCalledWith('u1', 'u2');
  });
});
