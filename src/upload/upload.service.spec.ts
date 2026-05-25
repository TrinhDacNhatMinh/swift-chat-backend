import { Test, TestingModule } from '@nestjs/testing';
import {
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';

// Mock cloudinary
jest.mock('cloudinary', () => ({
  v2: {
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));
import { v2 as cloudinary } from 'cloudinary';

describe('UploadService', () => {
  let service: UploadService;
  let configService: Record<string, jest.Mock>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    service = module.get<UploadService>(UploadService);
  });

  afterEach(() => jest.clearAllMocks());

  const mockFile = {
    buffer: Buffer.from('file-content'),
    originalname: 'test.jpg',
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  // =========================================================================
  // uploadFile()
  // =========================================================================
  describe('uploadFile()', () => {
    it('should throw ServiceUnavailableException when Cloudinary is not configured in uploadFile()', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw ServiceUnavailableException when only partial config is present in uploadFile()', async () => {
      configService.get
        .mockReturnValueOnce('cloud-name')
        .mockReturnValueOnce('api-key')
        .mockReturnValueOnce(undefined); // missing API secret

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should upload file successfully and return result when uploadFile() succeeds', async () => {
      configService.get
        .mockReturnValueOnce('cloud-name')
        .mockReturnValueOnce('api-key')
        .mockReturnValueOnce('api-secret');

      const uploadResult = {
        secure_url: 'https://res.cloudinary.com/test.jpg',
        public_id: 'swift-chat/test',
        resource_type: 'image',
        format: 'jpg',
        bytes: 1024,
      };

      // Mock upload_stream to call the callback with success
      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_opts, callback) => {
          // Return a writable stream mock with end()
          return {
            end: jest.fn().mockImplementation(() => {
              callback(null, uploadResult);
            }),
          };
        },
      );

      const result = await service.uploadFile(mockFile);

      expect(result).toEqual(uploadResult);
      expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: 'swift-chat',
          resource_type: 'auto',
        }),
        expect.any(Function),
      );
    });

    it('should throw BadRequestException when uploadFile() encounters an upload error', async () => {
      configService.get
        .mockReturnValueOnce('cloud-name')
        .mockReturnValueOnce('api-key')
        .mockReturnValueOnce('api-secret');

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_opts, callback) => ({
          end: jest.fn().mockImplementation(() => {
            callback({ message: 'Upload failed' }, null);
          }),
        }),
      );

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when result is null in uploadFile()', async () => {
      configService.get
        .mockReturnValueOnce('cloud-name')
        .mockReturnValueOnce('api-key')
        .mockReturnValueOnce('api-secret');

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_opts, callback) => ({
          end: jest.fn().mockImplementation(() => {
            callback(null, null); // no error but no result
          }),
        }),
      );

      await expect(service.uploadFile(mockFile)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
