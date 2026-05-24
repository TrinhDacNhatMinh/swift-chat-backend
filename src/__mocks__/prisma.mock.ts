/**
 * Shared mock factory for PrismaService.
 * Usage in spec files:
 *   providers: [{ provide: PrismaService, useValue: createMockPrismaService() }]
 *
 * The `$transaction` mock executes the callback with a reference to *itself*
 * so that `tx.friendRequest.update(...)` etc. hit the same jest.fn() stubs.
 */
export interface MockPrismaService {
  user: Record<string, jest.Mock>;
  friend: Record<string, jest.Mock>;
  friendRequest: Record<string, jest.Mock>;
  conversation: Record<string, jest.Mock>;
  participant: Record<string, jest.Mock>;
  notification: Record<string, jest.Mock>;
  refreshToken: Record<string, jest.Mock>;
  deviceToken: Record<string, jest.Mock>;
  $transaction: jest.Mock;
}

export const createMockPrismaService = (): MockPrismaService => {
  const mock: MockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    friend: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    friendRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    conversation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    participant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    deviceToken: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  // By default, $transaction executes the callback with `mock` itself as the
  // transactional client, so callers can assert on the same jest.fn() stubs.
  mock.$transaction.mockImplementation(
    (fn: (tx: MockPrismaService) => unknown) => fn(mock),
  );

  return mock;
};
