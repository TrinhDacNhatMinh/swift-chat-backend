import { Test, TestingModule } from '@nestjs/testing';
import { MessageArchivingService } from './message-archiving.service';
import { getModelToken } from '@nestjs/mongoose';
import { Message, MessageArchive } from './schemas/message.schema';
import { ConfigService } from '@nestjs/config';

describe('MessageArchivingService', () => {
  let service: MessageArchivingService;
  let messageModel: any;
  let messageArchiveModel: any;
  let configService: any;

  beforeEach(async () => {
    messageModel = {
      find: jest.fn(),
      deleteMany: jest.fn(),
    };

    messageArchiveModel = {
      insertMany: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue(30), // Default 30 days
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageArchivingService,
        {
          provide: getModelToken(Message.name),
          useValue: messageModel,
        },
        {
          provide: getModelToken(MessageArchive.name),
          useValue: messageArchiveModel,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<MessageArchivingService>(MessageArchivingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleArchiving', () => {
    it('should not do anything if no old messages are found', async () => {
      messageModel.find.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      await service.handleArchiving();

      expect(messageModel.find).toHaveBeenCalled();
      expect(messageArchiveModel.insertMany).not.toHaveBeenCalled();
      expect(messageModel.deleteMany).not.toHaveBeenCalled();
    });

    it('should archive messages in batches and stop when no more are found', async () => {
      const mockMessagesBatch1 = [
        { _id: '1', created_at: new Date('2020-01-01') },
        { _id: '2', created_at: new Date('2020-01-02') },
      ];
      const mockMessagesBatch2 = [];

      // First call returns batch 1, second call returns empty (stop loop)
      const execMock = jest.fn()
        .mockResolvedValueOnce(mockMessagesBatch1)
        .mockResolvedValueOnce(mockMessagesBatch2);

      messageModel.find.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: execMock,
      });

      await service.handleArchiving();

      expect(messageModel.find).toHaveBeenCalledTimes(2);
      expect(messageArchiveModel.insertMany).toHaveBeenCalledWith(mockMessagesBatch1);
      expect(messageArchiveModel.insertMany).toHaveBeenCalledTimes(1);
      expect(messageModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['1', '2'] } });
      expect(messageModel.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('should stop archiving if an error occurs to prevent data loss', async () => {
      const mockMessagesBatch1 = [
        { _id: '1', created_at: new Date('2020-01-01') },
      ];

      const execMock = jest.fn().mockResolvedValueOnce(mockMessagesBatch1);
      
      messageModel.find.mockReturnValue({
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: execMock,
      });

      // Force insertMany to throw an error
      messageArchiveModel.insertMany.mockRejectedValue(new Error('DB Error'));

      await service.handleArchiving();

      expect(messageModel.find).toHaveBeenCalledTimes(1);
      expect(messageArchiveModel.insertMany).toHaveBeenCalledTimes(1);
      
      // Because insert failed, deleteMany should NOT be called to avoid data loss
      expect(messageModel.deleteMany).not.toHaveBeenCalled();
    });
  });
});
