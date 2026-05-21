import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { getModelToken } from '@nestjs/mongoose';
import { Message } from '../../src/messages/schemas/message.schema';

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  // 1. Lấy tất cả test users
  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    select: { id: true },
  });

  if (testUsers.length === 0) return;
  const testUserIds = testUsers.map((u) => u.id);

  // 2. Lấy các conversation chứa test users
  const testParticipants = await prisma.participant.findMany({
    where: { userId: { in: testUserIds } },
    select: { conversationId: true },
  });
  const testConversationIds = [
    ...new Set(testParticipants.map((p) => p.conversationId)),
  ];

  // 3. Xóa dữ liệu an toàn theo thứ tự FK
  await prisma.deviceToken.deleteMany({
    where: { userId: { in: testUserIds } },
  });
  await prisma.notification.deleteMany({
    where: {
      OR: [{ userId: { in: testUserIds } }, { actorId: { in: testUserIds } }],
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
        { senderId: { in: testUserIds } },
        { receiverId: { in: testUserIds } },
      ],
    },
  });
  await prisma.friend.deleteMany({
    where: {
      OR: [{ userId1: { in: testUserIds } }, { userId2: { in: testUserIds } }],
    },
  });
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: testUserIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: testUserIds } },
  });

  // MongoDB messages
  try {
    const messageModel = app.get(getModelToken(Message.name));
    if (testConversationIds.length > 0) {
      await messageModel.deleteMany({
        conversationId: { $in: testConversationIds },
      });
    }
  } catch {
    // Message model may not be available in all test suites
  }
}
