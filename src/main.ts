import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis/redis.adapter';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from './redis/redis.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Setup Redis Adapter for WebSocket
  const pubClient = app.get(REDIS_PUB_CLIENT);
  const subClient = app.get(REDIS_SUB_CLIENT);
  app.useWebSocketAdapter(new RedisIoAdapter(app, pubClient, subClient));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
