import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { MessagesService } from './messages.service';
import { Message, MessageArchive, MessageType } from './schemas/message.schema';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service';

// ---------------------------------------------------------------------------
// Mock Mongoose Model
// ---------------------------------------------------------------------------
const createMockModel = () => {
  const instance = {
    save: jest.fn().mockReturnThis(),
    conversation_id: '',
    sender_id: '',
    content: '',
    type: MessageType.TEXT,
    _id: { toString: () => 'msg-1' },
    created_at: new Date(),
    updated_at: new Date(),
  };

  const model: any = jest.fn().mockImplementation((data) => {
    Object.assign(instance, data);
    return instance;
  });

  // Static (chainable) query methods
  model.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    }),
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    }),
  });

  model.findOne = jest.fn().mockResolvedValue(null);
  model.findById = jest.fn().mockResolvedValue(null);
  model.findOneAndUpdate = jest.fn().mockResolvedValue(null);
  model.updateMany = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({}),
  });

  return { model, instance };
};

describe('MessagesService', () => {
  let service: MessagesService;
  let mockModel: ReturnType<typeof createMockModel>;
  let mockArchiveModel: ReturnType<typeof createMockModel>;
  let mockConfigService: any;
  let mockConversationsService: any;

  beforeEach(async () => {
    mockModel = createMockModel();
    mockArchiveModel = createMockModel();
    mockConfigService = {
      get: jest.fn().mockReturnValue(30),
    };
    mockConversationsService = {
      isParticipant: jest.fn().mockResolvedValue(true),
      getUserConversationIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Message.name), useValue: mockModel.model },
        {
          provide: getModelToken(MessageArchive.name),
          useValue: mockArchiveModel.model,
        },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ConversationsService,
          useValue: mockConversationsService,
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  afterEach(() => jest.clearAllMocks());

  // create()

  describe('create()', () => {
    it('should create text message with default type when create() is called without type', async () => {
      const dto = { conversationId: 'c1', content: 'hello' };

      await service.create('u1', dto);

      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'c1',
          sender_id: 'u1',
          content: 'hello',
          type: MessageType.TEXT,
        }),
      );
      expect(mockModel.instance.save).toHaveBeenCalled();
    });

    it('should create message with specified type when create() is called with explicit type', async () => {
      const dto = {
        conversationId: 'c1',
        content: 'img.png',
        type: MessageType.IMAGE,
      };

      await service.create('u1', dto);

      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({ type: MessageType.IMAGE }),
      );
    });
  });

  // findByConversation()

  describe('findByConversation()', () => {
    it('should throw ForbiddenException if not a participant in findByConversation()', async () => {
      mockConversationsService.isParticipant.mockResolvedValue(false);

      await expect(service.findByConversation('c1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should query without cursor filter when findByConversation() is called without cursor', async () => {
      await service.findByConversation('c1', 'u1');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall).toEqual({
        conversation_id: 'c1',
        deleted_by: { $ne: 'u1' },
      });
      expect(findCall._id).toBeUndefined();
    });

    it('should add $lt filter when findByConversation() is called with cursor', async () => {
      await service.findByConversation('c1', 'u1', '7f000000bcf86cd799439011');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeDefined();
      expect(findCall._id.$lt).toBeDefined();
    });
  });

  // unsendMessage()

  describe('unsendMessage()', () => {
    it('should return null when message not found in unsendMessage()', async () => {
      mockModel.model.findOne.mockResolvedValue(null);
      mockArchiveModel.model.findOne.mockResolvedValue(null);

      const result = await service.unsendMessage(
        '507f1f77bcf86cd799439011',
        'wrong-user',
      );

      expect(result).toBeNull();
    });

    it('should set is_unsent and deleted_at when unsendMessage() succeeds, and trigger bulk update for replies', async () => {
      mockModel.model.findOne.mockResolvedValue({
        created_at: new Date(),
        get: () => new Date(),
      });
      const unsent = {
        _id: { toString: () => 'msg1' },
        is_unsent: true,
        created_at: new Date(),
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(unsent);

      const validId = '507f1f77bcf86cd799439011';
      const result = await service.unsendMessage(validId, 'u1');

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({
          is_unsent: true,
          deleted_at: expect.any(Date),
        }),
        { new: true },
      );

      expect(mockModel.model.updateMany).toHaveBeenCalledWith(
        { 'reply_to.messageId': validId },
        { $set: { 'reply_to.content': '' } },
      );

      expect(result).toEqual(service.toDto(unsent as any));
    });
  });

  // deleteForMe()

  describe('deleteForMe()', () => {
    it('should add accountId to deleted_by array when deleteForMe() succeeds', async () => {
      const deleted = {
        _id: { toString: () => 'msg1' },
        created_at: new Date(),
        deleted_by: ['u1'],
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(deleted);

      const result = await service.deleteForMe(
        '507f1f77bcf86cd799439011',
        'u1',
      );

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        expect.objectContaining({
          $addToSet: { deleted_by: 'u1' },
        }),
        { new: true },
      );
      expect(result).toEqual(service.toDto(deleted as any));
    });
  });

  // editMessage()

  describe('editMessage()', () => {
    it('should update content and set is_edited when editMessage() succeeds', async () => {
      const edited = {
        _id: { toString: () => 'msg1' },
        created_at: new Date(),
        content: 'updated',
        is_edited: true,
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(edited);

      const result = await service.editMessage(
        '507f1f77bcf86cd799439011',
        'u1',
        'updated',
      );

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ sender_id: 'u1', is_unsent: false }),
        expect.objectContaining({ content: 'updated', is_edited: true }),
        { new: true },
      );
      expect(result).toEqual(service.toDto(edited as any));
    });

    it('should return null when message is deleted in editMessage()', async () => {
      mockModel.model.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.editMessage(
        '507f1f77bcf86cd799439011',
        'u1',
        'x',
      );

      expect(result).toBeNull();
    });
  });

  // create() — reply to message

  describe('create() with replyToMessageId', () => {
    const VALID_OID = '507f1f77bcf86cd799439011';

    it('should set reply_to snapshot when replyToMessageId is valid and original is from same conversation', async () => {
      const originalMsg = {
        _id: { toString: () => VALID_OID },
        sender_id: 'u2',
        content: 'original text',
        type: MessageType.TEXT,
        conversation_id: 'c1',
      };
      mockModel.model.findById.mockResolvedValue(originalMsg);

      const dto = {
        conversationId: 'c1',
        content: 'reply text',
        replyToMessageId: VALID_OID,
      };

      await service.create('u1', dto);

      expect(mockModel.model.findById).toHaveBeenCalledWith(VALID_OID);
      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_to: {
            messageId: VALID_OID,
            senderId: 'u2',
            content: 'original text',
            type: MessageType.TEXT,
          },
        }),
      );
    });

    it('should set reply_to content to empty string when original message is unsent', async () => {
      const originalMsg = {
        _id: { toString: () => VALID_OID },
        sender_id: 'u2',
        content: 'original text',
        is_unsent: true,
        type: MessageType.TEXT,
        conversation_id: 'c1',
      };
      mockModel.model.findById.mockResolvedValue(originalMsg);

      await service.create('u1', {
        conversationId: 'c1',
        content: 'reply',
        replyToMessageId: VALID_OID,
      });

      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({
          reply_to: expect.objectContaining({ content: '' }),
        }),
      );
    });

    it('should throw BadRequestException when original message is deleted by sender', async () => {
      const originalMsg = {
        _id: { toString: () => VALID_OID },
        sender_id: 'u2',
        deleted_by: ['u1'], // sender deleted it
        conversation_id: 'c1',
      };
      mockModel.model.findById.mockResolvedValue(originalMsg);

      await expect(
        service.create('u1', {
          conversationId: 'c1',
          content: 'reply',
          replyToMessageId: VALID_OID,
        }),
      ).rejects.toThrow('Cannot reply to a message you have deleted');
    });

    it('should set reply_to to null when original message is from a different conversation', async () => {
      mockModel.model.findById.mockResolvedValue({
        _id: { toString: () => VALID_OID },
        conversation_id: 'OTHER_CONV', // different conversation
        sender_id: 'u2',
        content: 'text',
        type: MessageType.TEXT,
      });

      await service.create('u1', {
        conversationId: 'c1',
        content: 'reply',
        replyToMessageId: VALID_OID,
      });

      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({ reply_to: null }),
      );
    });

    it('should set reply_to to null when original message does not exist', async () => {
      mockModel.model.findById.mockResolvedValue(null);

      await service.create('u1', {
        conversationId: 'c1',
        content: 'reply',
        replyToMessageId: VALID_OID,
      });

      expect(mockModel.model).toHaveBeenCalledWith(
        expect.objectContaining({ reply_to: null }),
      );
    });
  });

  // toggleReaction()

  describe('toggleReaction()', () => {
    const MSG_ID = '507f1f77bcf86cd799439011';

    it('should ADD reaction via $push when emoji does not exist yet in toggleReaction()', async () => {
      // findOne returns null → reaction doesn't exist
      mockModel.model.findOne.mockResolvedValue(null);
      const updated = {
        _id: { toString: () => MSG_ID },
        created_at: new Date(),
        reactions: [{ emoji: '👍', accountId: 'u1', createdAt: new Date() }],
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(updated);

      const result = await service.toggleReaction(MSG_ID, 'u1', '👍');

      expect(mockModel.model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'reactions.accountId': 'u1',
        }),
      );
      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ $push: expect.any(Object) }),
        { new: true },
      );
      expect(result).toEqual(service.toDto(updated as any));
    });

    it('should REMOVE reaction via $pull when emoji already exists in toggleReaction()', async () => {
      // findOne returns a document → reaction exists
      mockModel.model.findOne.mockResolvedValue({
        _id: MSG_ID,
        reactions: [{ accountId: 'u1', emoji: '👍' }],
      });
      const updated = {
        _id: { toString: () => MSG_ID },
        created_at: new Date(),
        reactions: [],
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(updated);

      const result = await service.toggleReaction(MSG_ID, 'u1', '👍');

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ $pull: expect.any(Object) }),
        { new: true },
      );
      expect(result).toEqual(service.toDto(updated as any));
    });

    it('should return null when message is not found after update in toggleReaction()', async () => {
      mockModel.model.findOne.mockResolvedValue(null);
      mockModel.model.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.toggleReaction(MSG_ID, 'u1', '❤️');

      expect(result).toBeNull();
    });
  });

  // globalSearch()

  describe('globalSearch()', () => {
    it('should return empty array if conversationIds is empty', async () => {
      // Mock getUserConversationIds to return empty array
      mockConversationsService.getUserConversationIds.mockResolvedValue([]);

      const result = await service.globalSearch('hello', 'u1');
      expect(result).toEqual([]);
      expect(mockModel.model.find).not.toHaveBeenCalled();
    });

    it('should pass regex search query with single conversationId when globalSearch() is called', async () => {
      mockConversationsService.isParticipant.mockResolvedValue(true);

      await service.globalSearch('hello', 'u1', 'c1');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall).toEqual(
        expect.objectContaining({
          conversation_id: { $in: ['c1'] },
          deleted_by: { $ne: 'u1' },
          is_unsent: false,
          content: { $regex: 'hello', $options: 'i' },
        }),
      );
    });

    it('should throw ForbiddenException if account not participant in globalSearch()', async () => {
      mockConversationsService.isParticipant.mockResolvedValue(false);

      await expect(service.globalSearch('hello', 'u1', 'c1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should apply masking even when results are merged from hot and archive', async () => {
      mockConversationsService.getUserConversationIds.mockResolvedValue(['c1']);

      const hotMessage = {
        _id: new Types.ObjectId(),
        conversation_id: 'c1',
        sender_id: 'u2',
        content: 'hot result',
        created_at: new Date(),
        updated_at: new Date(),
        reply_to: {
          messageId: new Types.ObjectId().toString(),
          senderId: 'u3',
          content: 'reply target',
          type: 'text',
        },
      };
      const archiveMessage = {
        _id: new Types.ObjectId(),
        conversation_id: 'c1',
        sender_id: 'u2',
        content: 'archive result',
        created_at: new Date(),
        updated_at: new Date(),
        reply_to: {
          messageId: new Types.ObjectId().toString(),
          senderId: 'u3',
          content: 'reply target archive',
          type: 'text',
        },
      };

      // Mock hot results returning less than limit
      mockModel.model.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValueOnce([hotMessage]),
          }),
        }),
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest
              .fn()
              .mockResolvedValueOnce([
                { _id: archiveMessage.reply_to.messageId },
              ]),
          }),
        }),
      });

      // Mock archive returning the rest
      mockArchiveModel.model.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValueOnce([archiveMessage]),
          }),
        }),
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValueOnce([]),
          }),
        }),
      });

      const result = await service.globalSearch('result', 'u1');

      // The archive message's reply should be masked
      expect(result).toHaveLength(2);
      expect(result[1].replyTo).toEqual({
        messageId: archiveMessage.reply_to.messageId,
        senderId: 'u3',
        content: '', // masked content
        type: 'text',
      });
    });

    it('should add $lt cursor filter when globalSearch() is called with cursor', async () => {
      await service.globalSearch(
        'hello',
        'u1',
        ['c1'],
        '7f000000bcf86cd799439011',
      );

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeDefined();
      expect(findCall._id.$lt).toBeDefined();
    });

    it('should NOT add cursor filter when globalSearch() is called without cursor', async () => {
      await service.globalSearch('hello', 'u1', ['c1']);

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeUndefined();
    });

    it('should pass sort by _id to find when globalSearch() is called', async () => {
      await service.globalSearch('hello', 'u1', ['c1']);

      // Ensure sort was called with { _id: -1 }
      expect(mockModel.model.find().sort).toHaveBeenCalledWith({ _id: -1 });
    });
  });
});
