import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageArchive,
  MessageDocument,
  MessageType,
} from './schemas/message.schema';
import { CreateMessageDto } from './dto/create-message.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(MessageArchive.name) private messageArchiveModel: Model<MessageDocument>,
    private configService: ConfigService,
  ) {}

  async create(
    senderId: string,
    dto: CreateMessageDto,
  ): Promise<MessageDocument> {
    let replyTo: any = null;

    if (dto.replyToMessageId) {
      const originalMessage = await this.messageModel.findById(
        dto.replyToMessageId,
      );
      if (
        originalMessage &&
        originalMessage.conversation_id === dto.conversationId
      ) {
        replyTo = {
          messageId: originalMessage._id.toString(),
          senderId: originalMessage.sender_id,
          content: originalMessage.content,
          type: originalMessage.type,
        };
      }
    }

    const message = new this.messageModel({
      conversation_id: dto.conversationId,
      sender_id: senderId,
      content: dto.content,
      type: dto.type || MessageType.TEXT,
      reply_to: replyTo,
    });

    return message.save();
  }

  async findByConversation(
    conversationId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<MessageDocument[]> {
    const query: Record<string, unknown> = {
      conversation_id: conversationId,
      is_deleted: false,
    };

    let useArchive = false;

    if (cursor) {
      const cursorObjectId = new Types.ObjectId(cursor);
      query._id = { $lt: cursorObjectId };
      
      const archiveDays = this.configService.get<number>('MESSAGE_ARCHIVE_DAYS', 30);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - archiveDays);
      
      if (cursorObjectId.getTimestamp() < cutoffDate) {
        useArchive = true;
      }
    }

    const model = useArchive ? this.messageArchiveModel : this.messageModel;

    let results = await model
      .find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
      
    // If querying hot collection returns fewer messages than limit (hit the boundary),
    // fetch the rest from the archive collection
    if (!useArchive && results.length < limit) {
      const remaining = limit - results.length;
      const archiveQuery = { ...query };
      
      if (results.length > 0) {
        // Continue from the oldest message we just found
        archiveQuery._id = { $lt: results[results.length - 1]._id };
      }
      
      const archiveResults = await this.messageArchiveModel
        .find(archiveQuery)
        .sort({ _id: -1 })
        .limit(remaining)
        .exec();
        
      results = [...results, ...archiveResults];
    }
    
    return results;
  }

  async searchMessages(
    conversationId: string,
    keyword: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<MessageDocument[]> {
    const query: Record<string, unknown> = {
      conversation_id: conversationId,
      is_deleted: false,
      $text: { $search: keyword },
    };

    let useArchiveOnly = false;
    
    if (cursor) {
      const cursorObjectId = new Types.ObjectId(cursor);
      query._id = { $lt: cursorObjectId };
      
      const archiveDays = this.configService.get<number>('MESSAGE_ARCHIVE_DAYS', 30);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - archiveDays);
      
      if (cursorObjectId.getTimestamp() < cutoffDate) {
        useArchiveOnly = true;
      }
    }

    if (useArchiveOnly) {
      return await this.messageArchiveModel
        .find(query, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, _id: -1 })
        .limit(limit)
        .exec();
    }

    const hotResults = await this.messageModel
      .find(query, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, _id: -1 })
      .limit(limit)
      .exec();
      
    if (hotResults.length < limit) {
      const remaining = limit - hotResults.length;
      const archiveQuery = { ...query };
      if (hotResults.length > 0) {
        archiveQuery._id = { $lt: hotResults[hotResults.length - 1]._id };
      }
      
      const archiveResults = await this.messageArchiveModel
        .find(archiveQuery, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, _id: -1 })
        .limit(remaining)
        .exec();
        
      return [...hotResults, ...archiveResults];
    }
    
    return hotResults;
  }

  async softDelete(
    messageId: string,
    senderId: string,
  ): Promise<MessageDocument | null> {
    let result = await this.messageModel.findOneAndUpdate(
      { _id: new Types.ObjectId(messageId), sender_id: senderId },
      { is_deleted: true, deleted_at: new Date() }, // Preserve content for audit trail
      { new: true },
    );
    
    if (!result) {
      result = await this.messageArchiveModel.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId), sender_id: senderId },
        { is_deleted: true, deleted_at: new Date() },
        { new: true },
      );
    }
    return result;
  }

  async editMessage(
    messageId: string,
    senderId: string,
    newContent: string,
  ): Promise<MessageDocument | null> {
    const query = {
      _id: new Types.ObjectId(messageId),
      sender_id: senderId,
      is_deleted: false, // Cannot edit deleted messages
    };
    const update = { content: newContent, is_edited: true };
    
    let result = await this.messageModel.findOneAndUpdate(query, update, { new: true });
    
    if (!result) {
      result = await this.messageArchiveModel.findOneAndUpdate(query, update, { new: true });
    }
    return result;
  }

  async toggleReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageDocument | null> {
    let exists = await this.messageModel.findOne({
      _id: new Types.ObjectId(messageId),
      reactions: { $elemMatch: { userId, emoji } },
    });
    
    let isArchive = false;
    
    if (!exists) {
      // Check if it exists in archive
      exists = await this.messageArchiveModel.findOne({
        _id: new Types.ObjectId(messageId),
        reactions: { $elemMatch: { userId, emoji } },
      });
      if (exists) isArchive = true;
    }

    const model = isArchive ? this.messageArchiveModel : this.messageModel;

    if (exists) {
      // Remove reaction
      return model.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId) },
        { $pull: { reactions: { userId, emoji } } },
        { new: true },
      );
    } else {
      // Add reaction. Try hot collection first.
      let result = await this.messageModel.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId) },
        {
          $push: {
            reactions: { emoji, userId, createdAt: new Date() },
          },
        },
        { new: true },
      );
      
      if (!result) {
        // Try archive collection.
        result = await this.messageArchiveModel.findOneAndUpdate(
          { _id: new Types.ObjectId(messageId) },
          {
            $push: {
              reactions: { emoji, userId, createdAt: new Date() },
            },
          },
          { new: true },
        );
      }
      
      return result;
    }
  }
}
