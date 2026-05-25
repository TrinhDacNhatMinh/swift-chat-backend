import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageDocument,
  MessageType,
} from './schemas/message.schema';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
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

    if (cursor) {
      query._id = { $lt: new Types.ObjectId(cursor) };
    }

    return await this.messageModel
      .find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
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

    if (cursor) {
      query._id = { $lt: new Types.ObjectId(cursor) };
    }

    return await this.messageModel
      .find(query, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, _id: -1 })
      .limit(limit)
      .exec();
  }

  async softDelete(
    messageId: string,
    senderId: string,
  ): Promise<MessageDocument | null> {
    return await this.messageModel.findOneAndUpdate(
      { _id: new Types.ObjectId(messageId), sender_id: senderId },
      { is_deleted: true, deleted_at: new Date() }, // Preserve content for audit trail
      { new: true },
    );
  }

  async editMessage(
    messageId: string,
    senderId: string,
    newContent: string,
  ): Promise<MessageDocument | null> {
    return await this.messageModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        sender_id: senderId,
        is_deleted: false, // Cannot edit deleted messages
      },
      { content: newContent, is_edited: true },
      { new: true },
    );
  }

  async toggleReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageDocument | null> {
    const exists = await this.messageModel.findOne({
      _id: new Types.ObjectId(messageId),
      reactions: { $elemMatch: { userId, emoji } },
    });

    if (exists) {
      // Remove reaction
      return this.messageModel.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId) },
        { $pull: { reactions: { userId, emoji } } },
        { new: true },
      );
    } else {
      // Add reaction
      return this.messageModel.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId) },
        {
          $push: {
            reactions: { emoji, userId, createdAt: new Date() },
          },
        },
        { new: true },
      );
    }
  }
}
