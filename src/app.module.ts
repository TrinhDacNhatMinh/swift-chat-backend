import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { configModuleOptions } from '../config/env';
import { CONFIG_KEYS } from './common/constants/config.constants';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { FriendsModule } from './friends/friends.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { ChatModule } from './chat/chat.module';
import { UploadModule } from './upload/upload.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FcmModule } from './fcm/fcm.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { BlockModule } from './block/block.module';
import { SocketEmitterModule } from './common/socket-emitter/socket-emitter.module';

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>(CONFIG_KEYS.THROTTLE_TTL, 60000),
          limit: config.get<number>(CONFIG_KEYS.THROTTLE_LIMIT, 100),
        },
      ],
    }),
    PrismaModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    AuthModule,
    UserModule,
    FriendsModule,
    BlockModule,
    ConversationsModule,
    MessagesModule,
    ChatModule,
    UploadModule,
    NotificationsModule,
    FcmModule,
    HealthModule,
    SocketEmitterModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
