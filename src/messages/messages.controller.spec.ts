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
    messagesService = {
      findByConversation: jest.fn(),
      searchMessages: jest.fn(),
    };
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

  afterEach(() => jest.clearAllMocks());

  it('should be decorated with JwtAuthGuard when class is evaluated', () => {
    const guards = Reflect.getMetadata('__guards__', MessagesController);
    const hasJwtAuthGuard = guards.some(
      (guard: any) => guard.name === 'JwtAuthGuard',
    );
    expect(hasJwtAuthGuard).toBe(true);
  });

  describe('findAll()', () => {
    it('should throw ForbiddenException when user is not a member in findAll()', async () => {
      conversationsService.isParticipant.mockResolvedValue(false);
      await expect(
        controller.findAll({ id: 'u1' }, 'c1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return messages when user is a member in findAll()', async () => {
      conversationsService.isParticipant.mockResolvedValue(true);
      const msgs = [{ _id: 'msg1' }];
      messagesService.findByConversation.mockResolvedValue(msgs);

      const result = await controller.findAll({ id: 'u1' }, 'c1', {
        cursor: 'cur',
        limit: 10,
      });

      expect(conversationsService.isParticipant).toHaveBeenCalledWith(
        'u1',
        'c1',
      );
      expect(messagesService.findByConversation).toHaveBeenCalledWith(
        'c1',
        'cur',
        10,
      );
      expect(result).toEqual(msgs);
    });
  });

  describe('searchMessages()', () => {
    it('should throw ForbiddenException when user is not a member in searchMessages()', async () => {
      conversationsService.isParticipant.mockResolvedValue(false);
      await expect(
        controller.searchMessages({ id: 'u1' }, 'c1', { q: 'test' } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return matched messages when user is a member in searchMessages()', async () => {
      conversationsService.isParticipant.mockResolvedValue(true);
      const msgs = [{ _id: 'msg1', content: 'test' }];
      messagesService.searchMessages.mockResolvedValue(msgs);

      const result = await controller.searchMessages({ id: 'u1' }, 'c1', {
        q: 'test',
        cursor: 'cur',
        limit: 10,
      });

      expect(conversationsService.isParticipant).toHaveBeenCalledWith(
        'u1',
        'c1',
      );
      expect(messagesService.searchMessages).toHaveBeenCalledWith(
        'c1',
        'test',
        'cur',
        10,
      );
      expect(result).toEqual(msgs);
    });
  });
});
