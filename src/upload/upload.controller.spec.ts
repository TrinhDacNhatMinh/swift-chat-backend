import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

describe('UploadController', () => {
  let controller: UploadController;
  let uploadService: Record<string, jest.Mock>;

  beforeEach(async () => {
    uploadService = { uploadFile: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [{ provide: UploadService, useValue: uploadService }],
    }).compile();
    controller = module.get<UploadController>(UploadController);
  });

  it('uploadFile() should throw BadRequestException when no file provided', async () => {
    await expect(controller.uploadFile(undefined as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('uploadFile() should return formatted response on success', async () => {
    uploadService.uploadFile.mockResolvedValue({
      secure_url: 'https://cdn.test/img.jpg',
      public_id: 'swift-chat/img',
      resource_type: 'image',
      format: 'jpg',
      bytes: 2048,
    });

    const result = await controller.uploadFile({
      buffer: Buffer.from('x'),
    } as any);

    expect(result).toEqual({
      url: 'https://cdn.test/img.jpg',
      publicId: 'swift-chat/img',
      resourceType: 'image',
      format: 'jpg',
      bytes: 2048,
    });
  });
});
