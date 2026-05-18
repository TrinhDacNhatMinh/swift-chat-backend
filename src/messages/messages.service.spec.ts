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
    it('should create text message with default type', async () => {
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

    it('should create message with specified type', async () => {
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
    it('should query without cursor filter when no cursor', async () => {
      await service.findByConversation('c1');

      const findCall = mockModel.model.find.mock.calls[0][0];
      expect(findCall).toEqual({ conversation_id: 'c1', is_deleted: false });
      expect(findCall._id).toBeUndefined();
    });

    it('should add $lt filter when cursor provided', async () => {
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
    it('should set is_deleted and deleted_at on success', async () => {
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

    it('should return null when message not found or wrong sender', async () => {
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
    it('should update content and set is_edited on success', async () => {
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

    it('should return null for deleted message', async () => {
      mockModel.model.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.editMessage(
        '507f1f77bcf86cd799439011',
        'u1',
        'x',
      );

      expect(result).toBeNull();
    });
  });
});
