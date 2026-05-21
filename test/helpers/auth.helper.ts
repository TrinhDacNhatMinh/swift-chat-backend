import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';

export interface TestUser {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  username: string;
}

export async function registerAndLogin(
  app: INestApplication<App>,
  suffix: string = '',
): Promise<TestUser> {
  const email = `user${suffix}@test.com`;
  const username = `testuser${suffix}`;
  const password = 'Test@123456';

  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, username, password });

  const loginRes = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return {
    accessToken: loginRes.body.accessToken,
    refreshToken: loginRes.body.refreshToken,
    userId: loginRes.body.user.id,
    email,
    username,
  };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// ─── WebSocket helpers ────────────────────────────────────────────────────────

/**
 * Creates an authenticated socket.io connection to the /chat namespace.
 * Uses autoConnect:false so listeners can be registered before connecting.
 * The caller is responsible for calling socket.disconnect() after each test.
 */
export function connectSocket(port: number, accessToken: string): Socket {
  return io(`http://localhost:${port}/chat`, {
    auth: { token: accessToken },
    transports: ['websocket'],
    autoConnect: false,
  });
}

/**
 * Connects a socket and waits until it is connected (or rejects on connect_error).
 */
export function connectAndWait(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (err) => reject(err));
    socket.connect();
  });
}

/**
 * Emits an event and waits for either:
 *   - the acknowledgement callback (success path), or
 *   - the `exception` event emitted by NestJS on WsException (error path).
 *
 * Resolves with the ack data on success, or with { status: 'error', message }
 * when the server throws a WsException. Rejects after timeoutMs.
 */
export function emitAck<T = unknown>(
  socket: Socket,
  event: string,
  payload?: unknown,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('exception', onException);
      resolve(value);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.off('exception', onException);
        reject(new Error(`emitAck timeout waiting for: ${event}`));
      }
    }, timeoutMs);

    // NestJS WsException path: server emits 'exception' instead of calling ack
    const onException = (err: unknown) => {
      const errObj =
        typeof err === 'object' && err !== null ? err : { message: err };
      settle({ status: 'error', ...errObj } as T);
    };
    socket.once('exception', onException);

    // Happy path: ack callback
    socket.emit(event, payload, (response: T) => {
      settle(response);
    });
  });
}

/**
 * Waits for the next emission of `event` on `socket`.
 * Rejects after timeoutMs milliseconds.
 */
export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForEvent timeout waiting for: ${event}`)),
      timeoutMs,
    );

    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
