import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationType } from './enums/conversation.enum';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      createConversation: jest.fn(),
      getUserConversations: jest.fn(),
      isParticipant: jest.fn(),
      getReadReceipts: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: service }],
    }).compile();
    controller = module.get<ConversationsController>(ConversationsController);
  });

  it('create() should pass user.id and dto', async () => {
    const dto = { type: ConversationType.DIRECT, partnerId: 'u2' };
    service.createConversation.mockResolvedValue({ id: 'c1' });
    await controller.create({ id: 'u1' }, dto);
    expect(service.createConversation).toHaveBeenCalledWith('u1', dto);
  });

  it('findAll() should pass user.id, limit, and offset', async () => {
    service.getUserConversations.mockResolvedValue({ data: [], total: 0 });
    await controller.findAll({ id: 'u1' }, { limit: 20, offset: 0 });
    expect(service.getUserConversations).toHaveBeenCalledWith('u1', 20, 0);
  });

  it('getReadReceipts() should throw ForbiddenException when not participant', async () => {
    service.isParticipant.mockResolvedValue(false);
    await expect(
      controller.getReadReceipts({ id: 'u1' }, 'c1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getReadReceipts() should return receipts when user is participant', async () => {
    service.isParticipant.mockResolvedValue(true);
    const receipts = [{ userId: 'u1', lastReadMessageId: 'msg1' }];
    service.getReadReceipts.mockResolvedValue(receipts);

    const result = await controller.getReadReceipts({ id: 'u1' }, 'c1');

    expect(service.isParticipant).toHaveBeenCalledWith('u1', 'c1');
    expect(result).toEqual(receipts);
  });
});
