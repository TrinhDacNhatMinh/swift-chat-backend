import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './redis/redis.adapter';
import { REDIS_PUB_CLIENT, REDIS_SUB_CLIENT } from './redis/redis.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';

  // ─── Helmet ────────────────────────────────────────────────────────────────
  // In production: full defaults (strict CSP etc.)
  // In development/test: disable CSP so Swagger UI (inline scripts) still works
  app.use(
    isProd
      ? helmet()
      : helmet({ contentSecurityPolicy: false }),
  );

  // ─── CORS ──────────────────────────────────────────────────────────────────
  // CORS_ORIGIN (comma-separated) → explicit allow-list
  // Empty + non-production              → regex matching any localhost port
  // Empty + production                  → block all cross-origin requests
  const rawOrigin = configService.get<string>('CORS_ORIGIN', '');
  let corsOrigin: string | RegExp | (string | RegExp)[] | boolean;

  if (rawOrigin) {
    corsOrigin = rawOrigin.split(',').map((o) => o.trim());
  } else if (!isProd) {
    corsOrigin = /^https?:\/\/localhost(:\d+)?$/;
  } else {
    corsOrigin = false;
  }

  app.enableCors({ origin: corsOrigin, credentials: true });

  // ─── Global prefix & pipes ─────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // ─── Rate Limit ────────────────────────────────────────────────────────────
  // ThrottlerModule is registered in AppModule; here we apply it globally.
  // Use @SkipThrottle() on any controller/handler that should be exempt.
  app.useGlobalGuards(app.get(ThrottlerGuard));

  // ─── Swagger (non-production only) ─────────────────────────────────────────
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Swift Chat API')
      .setDescription('The Swift Chat API description')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, documentFactory);
  }

  // ─── WebSocket (Redis adapter) ─────────────────────────────────────────────
  const pubClient = app.get(REDIS_PUB_CLIENT);
  const subClient = app.get(REDIS_SUB_CLIENT);
  app.useWebSocketAdapter(new RedisIoAdapter(app, pubClient, subClient));

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}
bootstrap();
