import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    // req ở đây là mockReq từ getRequestResponse bên dưới
    // hoặc là socket nếu class cha gọi getTracker trực tiếp
    const accountId = req?.data?.accountId || req?.accountId;
    if (accountId) {
      return Promise.resolve(accountId as string);
    }
    const ip = req?.ip || req?.handshake?.address || 'unknown-ws-client';
    return Promise.resolve(ip as string);
  }

  // Override để cung cấp mock HTTP request object thay vì HTTP req thật
  // ThrottlerGuard.handleRequest gọi req.header() nên cần mock method này
  protected getRequestResponse(context: ExecutionContext): {
    req: Record<string, any>;
    res: Record<string, any>;
  } {
    const client = context.switchToWs().getClient<Socket>();
    const headers = client.handshake?.headers || {};

    // Tạo mock request object có đầy đủ các method mà ThrottlerGuard cần
    const mockReq: Record<string, any> = {
      headers,
      ip: client.handshake?.address || 'unknown',
      data: client.data,
      accountId: client.data?.accountId,
      // Mock header() method — ThrottlerGuard gọi req.header('x-forwarded-for')
      header: (name: string) => headers[name.toLowerCase()],
      get: (name: string) => headers[name.toLowerCase()],
    };

    return { req: mockReq, res: mockReq };
  }

  protected throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    void context;
    void throttlerLimitDetail;
    throw new WsException('ThrottlerException: Too Many Requests');
  }
}
