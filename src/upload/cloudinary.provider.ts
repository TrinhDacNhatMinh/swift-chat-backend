import { Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

export const CLOUDINARY = 'CLOUDINARY';

export const CloudinaryProvider = {
  provide: CLOUDINARY,
  useFactory: (configService: ConfigService) => {
    const cloudName = configService
      .get<string>('CLOUDINARY_CLOUD_NAME')
      ?.trim();
    const apiKey = configService.get<string>('CLOUDINARY_API_KEY')?.trim();
    const apiSecret = configService
      .get<string>('CLOUDINARY_API_SECRET')
      ?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
      new Logger('CloudinaryProvider').warn(
        'CLOUDINARY_* env vars missing. File uploads are disabled. Add them to your env file to enable uploads.',
      );
      return null;
    }
    return cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  },
  inject: [ConfigService],
};
