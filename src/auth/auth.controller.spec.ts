import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FcmService } from '../fcm/fcm.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let fcmService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      googleLogin: jest.fn(),
      logout: jest.fn(),
    };
    fcmService = { registerDevice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: FcmService, useValue: fcmService },
      ],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  it('should delegate to authService.register when register() is called', async () => {
    const dto = { username: 'u', email: 'e@e.com', password: 'p' };
    authService.register.mockResolvedValue({ accessToken: 'at' });
    const result = await controller.register(dto);
    expect(authService.register).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ accessToken: 'at' });
  });

  it('should delegate to authService.login when login() is called', async () => {
    const dto = { username: 'u', password: 'p' };
    authService.login.mockResolvedValue({ accessToken: 'at' });
    await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('should delegate to authService.refreshToken when refreshToken() is called', async () => {
    const dto = { refreshToken: 'rt' };
    authService.refreshToken.mockResolvedValue({ accessToken: 'new-at' });
    await controller.refreshToken(dto);
    expect(authService.refreshToken).toHaveBeenCalledWith(dto);
  });

  it('should delegate to authService.googleLogin when googleLogin() is called', async () => {
    const dto = { idToken: 'tok' };
    authService.googleLogin.mockResolvedValue({ accessToken: 'at' });
    await controller.googleLogin(dto);
    expect(authService.googleLogin).toHaveBeenCalledWith(dto);
  });

  it('should pass user.id and refreshTokenDto to authService.logout when logout() is called', async () => {
    authService.logout.mockResolvedValue({ success: true });
    await controller.logout({ id: 'u1' }, { refreshToken: 'rt' });
    expect(authService.logout).toHaveBeenCalledWith('u1', {
      refreshToken: 'rt',
    });
  });

  it('should delegate to fcmService.registerDevice when registerDevice() is called', async () => {
    fcmService.registerDevice.mockResolvedValue({});
    await controller.registerDevice(
      { id: 'u1' },
      { token: 'tok', platform: 'android' },
    );
    expect(fcmService.registerDevice).toHaveBeenCalledWith(
      'u1',
      'tok',
      'android',
    );
  });
});
