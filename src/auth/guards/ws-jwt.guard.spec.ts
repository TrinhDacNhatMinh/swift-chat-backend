import { WsJwtGuard } from './ws-jwt.guard';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { ExecutionContext } from '@nestjs/common';

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  const mockSocket = (overrides: Record<string, any> = {}) => ({
    id: 'sock-1',
    data: {},
    handshake: {
      auth: {},
      headers: {},
    },
    ...overrides,
  });

  const mockContext = (socket: any): ExecutionContext =>
    ({
      switchToWs: () => ({ getClient: () => socket }),
    }) as any;

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('secret') };
    guard = new WsJwtGuard(jwtService as any, configService as any);
  });

  it('should return true when userId is already set in socket.data', () => {
    const socket = mockSocket({ data: { userId: 'u1' } });
    const result = guard.canActivate(mockContext(socket));
    expect(result).toBe(true);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('should verify token from handshake.auth.token and set userId', () => {
    const socket = mockSocket();
    socket.handshake.auth.token = 'valid-token';
    jwtService.verify.mockReturnValue({ sub: 'u1', email: 'e@e.com' });

    const result = guard.canActivate(mockContext(socket));

    expect(result).toBe(true);
    expect(socket.data.userId).toBe('u1');
    expect(socket.data.email).toBe('e@e.com');
  });

  it('should verify token from Authorization header as fallback', () => {
    const socket = mockSocket();
    socket.handshake.headers.authorization = 'Bearer header-token';
    jwtService.verify.mockReturnValue({ sub: 'u2', email: 'h@h.com' });

    const result = guard.canActivate(mockContext(socket));

    expect(result).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('header-token', {
      secret: 'secret',
    });
    expect(socket.data.userId).toBe('u2');
  });

  it('should throw WsException when no token is present', () => {
    const socket = mockSocket();
    expect(() => guard.canActivate(mockContext(socket))).toThrow(WsException);
  });

  it('should throw WsException when token verification fails', () => {
    const socket = mockSocket();
    socket.handshake.auth.token = 'bad-token';
    jwtService.verify.mockImplementation(() => {
      throw new Error('expired');
    });

    expect(() => guard.canActivate(mockContext(socket))).toThrow(WsException);
  });
});
