import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPasswordService } from './auth-password.service';
import { FcmService } from '../fcm/fcm.service';

jest.mock('../mail/mail.service');

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Record<string, jest.Mock>;
  let authPasswordService: Record<string, jest.Mock>;
  let fcmService: Record<string, jest.Mock>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      googleLogin: jest.fn(),
      logout: jest.fn(),
      verifyEmail: jest.fn(),
      resendVerificationOtp: jest.fn(),
    };
    authPasswordService = {
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
    };
    fcmService = { registerDevice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthPasswordService, useValue: authPasswordService },
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

  it('should delegate to authService.googleLogin when googleAuth() is called', async () => {
    const dto = { idToken: 'it' };
    authService.googleLogin.mockResolvedValue({ accessToken: 'at' });
    await controller.googleAuth(dto);
    expect(authService.googleLogin).toHaveBeenCalledWith(dto);
  });

  it('should pass user.id and refreshTokenDto to authService.logout when logout() is called', async () => {
    authService.logout.mockResolvedValue({ success: true });
    await controller.logout({ id: 'u1' }, { refreshToken: 'rt' });
    expect(authService.logout).toHaveBeenCalledWith('u1', 'rt');
  });

  it('should pass email to authPasswordService.forgotPassword', async () => {
    authPasswordService.forgotPassword.mockResolvedValue({ success: true });
    await controller.forgotPassword({ email: 'test@example.com' });
    expect(authPasswordService.forgotPassword).toHaveBeenCalledWith(
      'test@example.com',
    );
  });

  it('should pass token and newPassword to authPasswordService.resetPassword', async () => {
    authPasswordService.resetPassword.mockResolvedValue({ success: true });
    await controller.resetPassword({ token: 'abc', newPassword: '123' });
    expect(authPasswordService.resetPassword).toHaveBeenCalledWith(
      'abc',
      '123',
    );
  });

  it('should pass email and otp to authService.verifyEmail', async () => {
    authService.verifyEmail.mockResolvedValue({ success: true });
    await controller.verifyEmail({ email: 'e@e.com', otp: '123456' });
    expect(authService.verifyEmail).toHaveBeenCalledWith('e@e.com', '123456');
  });

  it('should pass email to authService.resendVerificationOtp', async () => {
    authService.resendVerificationOtp.mockResolvedValue({ success: true });
    await controller.resendVerificationOtp({ email: 'e@e.com' });
    expect(authService.resendVerificationOtp).toHaveBeenCalledWith('e@e.com');
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
