import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ConversationsService } from '../conversations/conversations.service';

describe('MessagesController', () => {
  let controller: MessagesController;
  let messagesService: Record<string, jest.Mock>;
  let conversationsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    messagesService = { findByConversation: jest.fn() };
    conversationsService = { isParticipant: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: ConversationsService, useValue: conversationsService },
      ],
    }).compile();
    controller = module.get<MessagesController>(MessagesController);
  });

  it('findAll() should throw ForbiddenException when not a member', async () => {
    conversationsService.isParticipant.mockResolvedValue(false);
    await expect(
      controller.findAll({ id: 'u1' }, 'c1', {} as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('findAll() should return messages when user is a member', async () => {
    conversationsService.isParticipant.mockResolvedValue(true);
    const msgs = [{ _id: 'msg1' }];
    messagesService.findByConversation.mockResolvedValue(msgs);

    const result = await controller.findAll({ id: 'u1' }, 'c1', {
      cursor: 'cur',
      limit: 10,
    });

    expect(conversationsService.isParticipant).toHaveBeenCalledWith('u1', 'c1');
    expect(messagesService.findByConversation).toHaveBeenCalledWith(
      'c1',
      'cur',
      10,
    );
    expect(result).toEqual(msgs);
  });
});
