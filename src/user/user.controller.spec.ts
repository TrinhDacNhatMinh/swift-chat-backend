import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let userService: Record<string, jest.Mock>;

  beforeEach(async () => {
    userService = {
      getUserProfile: jest.fn(),
      updateProfile: jest.fn(),
      searchByHandle: jest.fn(),
      getUserProfileByHandle: jest.fn(),
      changePassword: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    }).compile();
    controller = module.get<UserController>(UserController);
  });

  it('should call getUserProfile with current account id when getProfile() is called', async () => {
    userService.getUserProfile.mockResolvedValue({ id: 'u1' });
    const result = await controller.getProfile({ id: 'u1' });
    expect(userService.getUserProfile).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'u1' });
  });

  it('should call updateProfile with account id and dto when updateProfile() is called', async () => {
    const dto = { username: 'newname' };
    userService.updateProfile.mockResolvedValue({
      id: 'u1',
      username: 'newname',
    });
    await controller.updateProfile({ id: 'u1' }, dto);
    expect(userService.updateProfile).toHaveBeenCalledWith('u1', dto);
  });

  it('should call searchByHandle with query, scope and current account id when searchUsers() is called', async () => {
    userService.searchByHandle.mockResolvedValue([]);
    await controller.searchUsers(
      { q: 'test', scope: 'all' as any },
      { id: 'u1' },
    );
    expect(userService.searchByHandle).toHaveBeenCalledWith(
      'test',
      'all',
      'u1',
    );
  });

  it('should call getUserProfileByHandle and return public profile when getUserProfileByHandle() is called', async () => {
    userService.getUserProfileByHandle.mockResolvedValue({
      id: 'u2',
      username: 'user2',
      handle: 'handle2',
      displayName: 'User 2',
      email: 'test@test.com',
      isEmailVerified: true,
      createdAt: new Date('2023-01-01'),
    });
    const result = await controller.getUserProfileByHandle('handle2');
    expect(userService.getUserProfileByHandle).toHaveBeenCalledWith('handle2');
    expect(result.id).toEqual('u2');
    expect((result as any).email).toBeUndefined();
    expect((result as any).isEmailVerified).toBeUndefined();
  });

  it('should call getUserProfile with param accountId and return public profile when getUserProfile() is called', async () => {
    userService.getUserProfile.mockResolvedValue({
      id: 'u2',
      username: 'user2',
      handle: 'handle2',
      displayName: 'User 2',
      email: 'test@test.com',
      isEmailVerified: true,
      createdAt: new Date('2023-01-01'),
    });
    const result = await controller.getUserProfile('u2');
    expect(userService.getUserProfile).toHaveBeenCalledWith('u2');
    expect(result.id).toEqual('u2');
    expect((result as any).email).toBeUndefined();
    expect((result as any).isEmailVerified).toBeUndefined();
  });

  it('should call changePassword with account id and dto when changePassword() is called', async () => {
    const dto = { currentPassword: 'old', newPassword: 'new' } as any;
    userService.changePassword.mockResolvedValue({ success: true });
    await controller.changePassword({ id: 'u1' }, dto);
    expect(userService.changePassword).toHaveBeenCalledWith('u1', 'old', 'new');
  });
});
