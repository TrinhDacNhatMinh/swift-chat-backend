import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module';

// Singleton: one app for the entire --runInBand suite run.
// Each test file calls createTestApp() / closeTestApp(); the app is only
// created on the first call and only destroyed when the ref-count reaches 0.
let app: INestApplication | null = null;
let refCount = 0;

async function buildApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const instance = moduleFixture.createNestApplication();

  instance.setGlobalPrefix('api/v1');
  instance.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  instance.enableShutdownHooks();

  // listen(0) binds to a random free port — required for socket.io-client
  // and still compatible with supertest's request(app.getHttpServer()).
  await instance.listen(0);

  return instance;
}

export async function createTestApp(): Promise<INestApplication> {
  if (!app) {
    app = await buildApp();
  }
  refCount++;
  return app;
}

export async function closeTestApp(): Promise<void> {
  refCount--;
  if (refCount <= 0) {
    await app?.close();
    app = null;
    refCount = 0;
  }
}

/** Returns the live HTTP server (for supertest). */
export function getTestHttpServer() {
  return app!.getHttpServer();
}

/** Returns the bound TCP port (for socket.io-client). */
export function getTestPort(): number {
  return (app!.getHttpServer().address() as AddressInfo).port;
}
