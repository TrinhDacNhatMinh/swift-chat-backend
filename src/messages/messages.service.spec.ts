import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MessagesService } from './messages.service';
import { Message, MessageType } from './schemas/message.schema';

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
  });

  model.findOne = jest.fn().mockResolvedValue(null);
  model.findById = jest.fn().mockResolvedValue(null);
  model.findOneAndUpdate = jest.fn().mockResolvedValue(null);

  return { model, instance };
};

describe('MessagesService', () => {
  let service: MessagesService;
  let mockModel: ReturnType<typeof createMockModel>;

  beforeEach(async () => {
    mockModel = createMockModel();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Message.name), useValue: mockModel.model },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // create()
  // =========================================================================
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

  // =========================================================================
  // findByConversation()
  // =========================================================================
  describe('findByConversation()', () => {
    it('should query without cursor filter when findByConversation() is called without cursor', async () => {
      await service.findByConversation('c1');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall).toEqual({ conversation_id: 'c1', is_deleted: false });
      expect(findCall._id).toBeUndefined();
    });

    it('should add $lt filter when findByConversation() is called with cursor', async () => {
      await service.findByConversation('c1', '507f1f77bcf86cd799439011');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeDefined();
      expect(findCall._id.$lt).toBeDefined();
    });
  });

  // =========================================================================
  // softDelete()
  // =========================================================================
  describe('softDelete()', () => {
    it('should set is_deleted and deleted_at when softDelete() succeeds', async () => {
      const deleted = { _id: 'msg1', is_deleted: true };
      mockModel.model.findOneAndUpdate.mockResolvedValue(deleted);

      const result = await service.softDelete('507f1f77bcf86cd799439011', 'u1');

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ sender_id: 'u1' }),
        expect.objectContaining({
          is_deleted: true,
          deleted_at: expect.any(Date),
        }),
        { new: true },
      );
      expect(result).toEqual(deleted);
    });

    it('should return null when message not found or wrong sender in softDelete()', async () => {
      mockModel.model.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.softDelete(
        '507f1f77bcf86cd799439011',
        'wrong-user',
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // editMessage()
  // =========================================================================
  describe('editMessage()', () => {
    it('should update content and set is_edited when editMessage() succeeds', async () => {
      const edited = { _id: 'msg1', content: 'updated', is_edited: true };
      mockModel.model.findOneAndUpdate.mockResolvedValue(edited);

      const result = await service.editMessage(
        '507f1f77bcf86cd799439011',
        'u1',
        'updated',
      );

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ sender_id: 'u1', is_deleted: false }),
        expect.objectContaining({ content: 'updated', is_edited: true }),
        { new: true },
      );
      expect(result).toEqual(edited);
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

  // =========================================================================
  // create() — reply to message
  // =========================================================================
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

  // =========================================================================
  // toggleReaction()
  // =========================================================================
  describe('toggleReaction()', () => {
    const MSG_ID = '507f1f77bcf86cd799439011';

    it('should ADD reaction via $push when emoji does not exist yet in toggleReaction()', async () => {
      // findOne returns null → reaction doesn't exist
      mockModel.model.findOne.mockResolvedValue(null);
      const updated = {
        _id: MSG_ID,
        reactions: [{ emoji: '👍', userId: 'u1' }],
      };
      mockModel.model.findOneAndUpdate.mockResolvedValue(updated);

      const result = await service.toggleReaction(MSG_ID, 'u1', '👍');

      expect(mockModel.model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          reactions: { $elemMatch: { userId: 'u1', emoji: '👍' } },
        }),
      );
      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ $push: expect.any(Object) }),
        { new: true },
      );
      expect(result).toEqual(updated);
    });

    it('should REMOVE reaction via $pull when emoji already exists in toggleReaction()', async () => {
      // findOne returns a document → reaction exists
      mockModel.model.findOne.mockResolvedValue({ _id: MSG_ID });
      const updated = { _id: MSG_ID, reactions: [] };
      mockModel.model.findOneAndUpdate.mockResolvedValue(updated);

      const result = await service.toggleReaction(MSG_ID, 'u1', '👍');

      expect(mockModel.model.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ $pull: expect.any(Object) }),
        { new: true },
      );
      expect(result).toEqual(updated);
    });

    it('should return null when message is not found after update in toggleReaction()', async () => {
      mockModel.model.findOne.mockResolvedValue(null);
      mockModel.model.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.toggleReaction(MSG_ID, 'u1', '❤️');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // searchMessages()
  // =========================================================================
  describe('searchMessages()', () => {
    it('should pass $text search query with conversationId when searchMessages() is called', async () => {
      await service.searchMessages('c1', 'hello');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall).toEqual(
        expect.objectContaining({
          conversation_id: 'c1',
          is_deleted: false,
          $text: { $search: 'hello' },
        }),
      );
    });

    it('should add $lt cursor filter when searchMessages() is called with cursor', async () => {
      await service.searchMessages('c1', 'hello', '507f1f77bcf86cd799439011');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeDefined();
      expect(findCall._id.$lt).toBeDefined();
    });

    it('should NOT add cursor filter when searchMessages() is called without cursor', async () => {
      await service.searchMessages('c1', 'hello');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall._id).toBeUndefined();
    });

    it('should pass textScore projection and sort to find when searchMessages() is called', async () => {
      await service.searchMessages('c1', 'hello');

      const projection = mockModel.model.find.mock.calls[0][1];
      expect(projection).toEqual({ score: { $meta: 'textScore' } });
    });
  });
});
