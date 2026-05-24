import { Global, Module, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_PUB_CLIENT = 'REDIS_PUB_CLIENT';
export const REDIS_SUB_CLIENT = 'REDIS_SUB_CLIENT';

const logger = new Logger('RedisModule');

const getRedisOptions = (configService: ConfigService): RedisOptions => {
  const password = configService.get<string>('REDIS_PASSWORD');
  const tlsEnabled = configService.get<boolean>('REDIS_TLS');
  return {
    host: configService.getOrThrow<string>('REDIS_HOST'),
    port: configService.getOrThrow<number>('REDIS_PORT'),
    ...(password ? { password } : {}),
    ...(tlsEnabled ? { tls: {} } : {}),
  };
};

const createRedisClient = (configService: ConfigService): Redis => {
  const client = new Redis(getRedisOptions(configService));
  client.on('error', (error) => {
    logger.warn(`Redis client connection error: ${error.message}`);
  });
  return client;
};

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => createRedisClient(configService),
      inject: [ConfigService],
    },
    {
      provide: REDIS_PUB_CLIENT,
      useFactory: (configService: ConfigService) => createRedisClient(configService),
      inject: [ConfigService],
    },
    {
      provide: REDIS_SUB_CLIENT,
      useFactory: (configService: ConfigService) => createRedisClient(configService),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT, REDIS_PUB_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(REDIS_PUB_CLIENT) private readonly pubClient: Redis,
    @Inject(REDIS_SUB_CLIENT) private readonly subClient: Redis,
  ) {}

  async onModuleDestroy() {
    await Promise.all([
      this.redisClient.quit(),
      this.pubClient.quit(),
      this.subClient.quit(),
    ]);
  }
}
