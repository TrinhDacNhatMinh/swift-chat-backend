import { config as loadDotenv } from 'dotenv';
import * as Joi from 'joi';

/** Resolves which `.env.*` file to load from NODE_ENV. */
export function getEnvFilePath(): string {
  return `.env.${process.env.NODE_ENV || 'development'}`;
}

/** Loads env file into `process.env` (no-op if file missing). Used by Prisma CLI and Nest. */
export function loadEnvFile(): void {
  loadDotenv({ path: getEnvFilePath() });
}

const optionalString = Joi.string().optional().allow('');

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  POSTGRESQL: Joi.string().required(),
  MONGODB_URI: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: optionalString,
  REDIS_TLS: Joi.boolean().truthy('true').falsy('false').optional(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),
  GOOGLE_CLIENT_ID: optionalString,
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  FIREBASE_PROJECT_ID: optionalString,
  FIREBASE_CLIENT_EMAIL: Joi.string().email().optional().allow(''),
  FIREBASE_PRIVATE_KEY: optionalString,
  CORS_ORIGIN: optionalString,
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),
})
  .custom((value, helpers) => {
    const firebaseFields = [
      value.FIREBASE_PROJECT_ID,
      value.FIREBASE_CLIENT_EMAIL,
      value.FIREBASE_PRIVATE_KEY,
    ];
    const firebaseSet = firebaseFields.filter(Boolean).length;
    if (firebaseSet > 0 && firebaseSet < 3) {
      return helpers.error('any.custom', {
        message:
          'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must all be set together',
      });
    }
    return value;
  })
  .messages({
    'any.custom': '{{#message}}',
  });

export const configModuleOptions = {
  isGlobal: true,
  envFilePath: getEnvFilePath(),
  validationSchema: envValidationSchema,
  validationOptions: {
    allowUnknown: true,
    abortEarly: true,
  },
};
