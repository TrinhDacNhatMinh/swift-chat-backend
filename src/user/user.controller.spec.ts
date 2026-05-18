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
      searchUsers: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    }).compile();
    controller = module.get<UserController>(UserController);
  });

  it('getProfile() should call getUserProfile with current user id', async () => {
    userService.getUserProfile.mockResolvedValue({ id: 'u1' });
    const result = await controller.getProfile({ id: 'u1' });
    expect(userService.getUserProfile).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'u1' });
  });

  it('updateProfile() should call updateProfile with user id and dto', async () => {
    const dto = { username: 'newname' };
    userService.updateProfile.mockResolvedValue({
      id: 'u1',
      username: 'newname',
    });
    await controller.updateProfile({ id: 'u1' }, dto);
    expect(userService.updateProfile).toHaveBeenCalledWith('u1', dto);
  });

  it('searchUsers() should call searchUsers with query and current user id', async () => {
    userService.searchUsers.mockResolvedValue([]);
    await controller.searchUsers({ query: 'test' }, { id: 'u1' });
    expect(userService.searchUsers).toHaveBeenCalledWith('test', 'u1');
  });

  it('getUserProfile() should call getUserProfile with param userId', async () => {
    userService.getUserProfile.mockResolvedValue({ id: 'u2' });
    const result = await controller.getUserProfile('u2');
    expect(userService.getUserProfile).toHaveBeenCalledWith('u2');
    expect(result).toEqual({ id: 'u2' });
  });
});
