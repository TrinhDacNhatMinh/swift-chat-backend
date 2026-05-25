import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Message, MessageDocument } from './schemas/message.schema';
import { MessageArchive } from './schemas/message.schema';

@Injectable()
export class MessageArchivingService {
  private readonly logger = new Logger(MessageArchivingService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(MessageArchive.name) private messageArchiveModel: Model<MessageDocument>,
    private configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleArchiving() {
    this.logger.log('Starting message archiving process...');
    
    // Default to 30 days if not specified in env
    const archiveDays = this.configService.get<number>('MESSAGE_ARCHIVE_DAYS', 30);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - archiveDays);

    let totalArchived = 0;
    let hasMore = true;
    const batchSize = 1000;

    while (hasMore) {
      try {
        // Find old messages that need to be archived
        const messagesToArchive = await this.messageModel
          .find({ created_at: { $lt: cutoffDate } })
          .limit(batchSize)
          .lean()
          .exec();

        if (messagesToArchive.length === 0) {
          hasMore = false;
          break;
        }

        // Insert into archive collection
        await this.messageArchiveModel.insertMany(messagesToArchive);

        // Delete from hot collection using their IDs
        const idsToDelete = messagesToArchive.map((msg) => msg._id);
        await this.messageModel.deleteMany({ _id: { $in: idsToDelete } });

        totalArchived += messagesToArchive.length;
        this.logger.log(`Archived batch of ${messagesToArchive.length} messages. Total so far: ${totalArchived}`);
      } catch (error) {
        this.logger.error('Error during message archiving batch:', error);
        hasMore = false; // Stop on error to prevent data loss or duplicate loops
        break;
      }
    }

    this.logger.log(`Message archiving process completed. Total archived: ${totalArchived}`);
  }
}
