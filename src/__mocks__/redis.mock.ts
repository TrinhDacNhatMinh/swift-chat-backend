/**
 * Shared mock factory for ioredis Redis client.
 * Usage in spec files:
 *   providers: [{ provide: REDIS_CLIENT, useValue: createMockRedis() }]
 */
export const createMockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  mget: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  expire: jest.fn(),
  eval: jest.fn(),
});
