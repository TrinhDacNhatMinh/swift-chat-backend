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

  it('should pass user.id and receiverId to friendsService.sendRequest when sendRequest() is called', async () => {
    friendsService.sendRequest.mockResolvedValue({ id: 'r1' });
    await controller.sendRequest({ id: 'u1' }, { receiverId: 'u2' });
    expect(friendsService.sendRequest).toHaveBeenCalledWith('u1', 'u2');
  });

  it('should pass user.id to friendsService.getPendingRequests when getPendingRequests() is called', async () => {
    friendsService.getPendingRequests.mockResolvedValue([]);
    await controller.getPendingRequests({ id: 'u1' });
    expect(friendsService.getPendingRequests).toHaveBeenCalledWith('u1');
  });

  it('should pass requestId, user.id, and action to friendsService.respondToRequest when respondToRequest() is called', async () => {
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

  it('should pass user.id, limit, and offset to friendsService.getFriends when getFriends() is called', async () => {
    friendsService.getFriends.mockResolvedValue({ data: [], total: 0 });
    await controller.getFriends({ id: 'u1' }, { limit: 10, offset: 5 });
    expect(friendsService.getFriends).toHaveBeenCalledWith('u1', 10, 5);
  });

  it('should pass user.id and target userId to friendsService.removeFriend when removeFriend() is called', async () => {
    friendsService.removeFriend.mockResolvedValue({ success: true });
    await controller.removeFriend({ id: 'u1' }, 'u2');
    expect(friendsService.removeFriend).toHaveBeenCalledWith('u1', 'u2');
  });
});
