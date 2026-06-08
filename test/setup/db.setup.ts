import { INestApplication } from '@nestjs/common';
import { Model } from 'mongoose';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getModelToken } from '@nestjs/mongoose';
import { Message } from '../../src/messages/schemas/message.schema';

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  // 1. Lấy tất cả test accounts
  const testAccounts = await prisma.account.findMany({
    where: { email: { endsWith: '@test.com' } },
    select: { id: true },
  });

  if (testAccounts.length === 0) return;
  const testAccountIds = testAccounts.map((u) => u.id);

  // 2. Lấy các conversation chứa test accounts
  const testParticipants = await prisma.participant.findMany({
    where: { accountId: { in: testAccountIds } },
    select: { conversationId: true },
  });
  const testConversationIds = [
    ...new Set(testParticipants.map((p) => p.conversationId)),
  ];

  // 3. Xóa dữ liệu an toàn theo thứ tự FK
  await prisma.deviceToken.deleteMany({
    where: { accountId: { in: testAccountIds } },
  });
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { accountId: { in: testAccountIds } },
        { actorId: { in: testAccountIds } },
      ],
    },
  });

  if (testConversationIds.length > 0) {
    await prisma.participant.deleteMany({
      where: { conversationId: { in: testConversationIds } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: testConversationIds } },
    });
  }

  await prisma.friendRequest.deleteMany({
    where: {
      OR: [
        { senderId: { in: testAccountIds } },
        { receiverId: { in: testAccountIds } },
      ],
    },
  });
  await prisma.friend.deleteMany({
    where: {
      OR: [
        { accountId1: { in: testAccountIds } },
        { accountId2: { in: testAccountIds } },
      ],
    },
  });
  await prisma.refreshToken.deleteMany({
    where: { accountId: { in: testAccountIds } },
  });
  await prisma.passwordResetToken.deleteMany({
    where: { accountId: { in: testAccountIds } },
  });
  await prisma.emailVerificationOtp.deleteMany({
    where: { accountId: { in: testAccountIds } },
  });
  // Note: Profile is deleted automatically due to Cascade on Account
  await prisma.account.deleteMany({
    where: { id: { in: testAccountIds } },
  });

  // MongoDB messages
  try {
    const messageModel = app.get<Model<Message>>(getModelToken(Message.name));
    if (testConversationIds.length > 0) {
      await messageModel.deleteMany({
        conversationId: { $in: testConversationIds },
      });
    }
  } catch {
    // Message model may not be available in all test suites
  }
}
