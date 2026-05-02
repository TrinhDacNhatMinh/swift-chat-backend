import { Test, TestingModule } from '@nestjs/testing';
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
      globalSearch: jest.fn(),
    };
    conversationsService = {
      isParticipant: jest.fn(),
      getUserConversationIds: jest.fn(),
    };

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
    it('should return messages when findAll() is called', async () => {
      const msgs = [{ _id: 'msg1' }];
      messagesService.findByConversation.mockResolvedValue(msgs);

      const result = await controller.findAll({ id: 'u1' }, 'c1', {
        cursor: 'cur',
        limit: 10,
      });

      expect(messagesService.findByConversation).toHaveBeenCalledWith(
        'c1',
        'u1',
        'cur',
        10,
      );
      expect(result).toEqual(msgs);
    });
  });

  describe('searchMessages()', () => {
    it('should call globalSearch with specified conversationId', async () => {
      const msgs = [{ _id: 'msg1', content: 'test' }];
      messagesService.globalSearch.mockResolvedValue(msgs);

      const result = await controller.searchMessages(
        { id: 'u1' },
        {
          q: 'test',
          conversationId: 'c1',
        },
      );

      expect(messagesService.globalSearch).toHaveBeenCalledWith(
        'test',
        'u1',
        'c1',
        undefined,
        undefined,
      );
      expect(result).toEqual(msgs);
    });

    it('should call globalSearch with undefined conversationId if not specified', async () => {
      const msgs = [{ _id: 'msg2', content: 'test2' }];
      messagesService.globalSearch.mockResolvedValue(msgs);

      const result = await controller.searchMessages(
        { id: 'u1' },
        {
          q: 'test2',
        },
      );

      expect(messagesService.globalSearch).toHaveBeenCalledWith(
        'test2',
        'u1',
        undefined,
        undefined,
        undefined,
      );
      expect(result).toEqual(msgs);
    });
  });
});
