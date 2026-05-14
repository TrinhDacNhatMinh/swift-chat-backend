import { Global, Module, Logger, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import mongoose, { Connection } from 'mongoose';

const logger = new Logger('DatabaseModule');

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
        // Retry and timeout configuration
        retryAttempts: 3,
        retryDelay: 5000, // 5 seconds between retries
        connectionFactory: (connection: Connection) => {
          connection.on('connected', () => {
            logger.log('MongoDB connected successfully');
          });

          connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected. Attempting to reconnect...');
          });

          connection.on('error', (error: Error) => {
            logger.error(`MongoDB connection error: ${error.message}`);
          });

          connection.on('reconnected', () => {
            logger.log('MongoDB reconnected successfully');
          });

          return connection;
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule implements OnModuleInit {
  onModuleInit() {
    const connState = mongoose.connection.readyState;
    const stateMap: Record<number, string> = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };
    logger.log(`MongoDB connection state: ${stateMap[connState] || 'unknown'}`);
  }
}

