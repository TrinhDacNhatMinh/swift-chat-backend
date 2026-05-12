import { Module } from '@nestjs/common';
import { FriendsService } from './friends.service';
import { FriendsController } from './friends.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockModule } from '../block/block.module';

@Module({
  imports: [PrismaModule, BlockModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
