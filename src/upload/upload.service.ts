import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { CONFIG_KEYS } from '../common/constants/config.constants';
import { ResourceType } from '../common/enums/resource-type.enum';

@Injectable()
export class UploadService {
  constructor(private readonly configService: ConfigService) {}

  async uploadFile(file: Express.Multer.File): Promise<UploadApiResponse> {
    const cloudName = this.configService
      .get<string>(CONFIG_KEYS.CLOUDINARY_CLOUD_NAME)
      ?.trim();
    const apiKey = this.configService
      .get<string>(CONFIG_KEYS.CLOUDINARY_API_KEY)
      ?.trim();
    const apiSecret = this.configService
      .get<string>(CONFIG_KEYS.CLOUDINARY_API_SECRET)
      ?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'File upload is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
    return await new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder: 'swift-chat',
          resource_type: ResourceType.AUTO, // auto-detect image/video/raw
        },
        (error, result) => {
          if (error)
            return reject(
              new BadRequestException('Upload failed: ' + error.message),
            );
          if (!result)
            return reject(new BadRequestException('Upload failed: no result'));
          resolve(result);
        },
      );
      upload.end(file.buffer);
    });
  }
}
