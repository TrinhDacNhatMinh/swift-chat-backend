import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIG_KEYS } from '../common/constants/config.constants';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private appInstance: INestApplication;

  constructor(app: INestApplication, pubClient: Redis, subClient: Redis) {
    super(app);
    this.appInstance = app;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const configService = this.appInstance.get(ConfigService);
    const rawOrigin = configService.get<string>(CONFIG_KEYS.CORS_ORIGIN, '');
    const isProd =
      configService.get<string>(CONFIG_KEYS.NODE_ENV) === 'production';

    let corsOrigin: string | RegExp | (string | RegExp)[] | boolean;

    if (rawOrigin) {
      corsOrigin = rawOrigin.split(',').map((o) => o.trim());
    } else if (!isProd) {
      corsOrigin = /^https?:\/\/localhost(:\d+)?$/;
    } else {
      corsOrigin = false;
    }

    const mergedOptions = {
      ...options,
      cors: {
        origin: corsOrigin,
        credentials: true,
      },
    };

    const server = super.createIOServer(port, mergedOptions) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
