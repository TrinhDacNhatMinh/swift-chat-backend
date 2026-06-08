/**
 * Shared mock factory for PrismaService.
 * Usage in spec files:
 *   providers: [{ provide: PrismaService, useValue: createMockPrismaService() }]
 *
 * The `$transaction` mock executes the callback with a reference to *itself*
 * so that `tx.friendRequest.update(...)` etc. hit the same jest.fn() stubs.
 */
export interface MockPrismaService {
  account: Record<string, jest.Mock>;
  friend: Record<string, jest.Mock>;
  friendRequest: Record<string, jest.Mock>;
  block: Record<string, jest.Mock>;
  conversation: Record<string, jest.Mock>;
  participant: Record<string, jest.Mock>;
  notification: Record<string, jest.Mock>;
  refreshToken: Record<string, jest.Mock>;
  deviceToken: Record<string, jest.Mock>;
  passwordResetToken: Record<string, jest.Mock>;
  emailVerificationOtp: Record<string, jest.Mock>;
  profile: Record<string, jest.Mock>;
  authProvider: Record<string, jest.Mock>;
  $transaction: jest.Mock;
}

export const createMockPrismaService = (): MockPrismaService => {
  const mock: MockPrismaService = {
    account: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    friend: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    friendRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    block: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
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
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    emailVerificationOtp: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    profile: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    authProvider: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  // $transaction supports two forms:
  // 1. Callback form: $transaction(tx => tx.model.op()) — used for interactive transactions
  // 2. Array form:   $transaction([op1, op2]) — used for sequential batch operations
  mock.$transaction.mockImplementation(
    (arg: ((tx: MockPrismaService) => unknown) | unknown[]) => {
      if (typeof arg === 'function') {
        return arg(mock);
      }
      // Array form: resolve all promises in the batch
      return Promise.all(arg);
    },
  );

  return mock;
};
