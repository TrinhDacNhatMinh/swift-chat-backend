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
    const message = new this.messageModel({
      conversation_id: dto.conversationId,
      sender_id: senderId,
      content: dto.content,
      type: dto.type || MessageType.TEXT,
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

    return this.messageModel.find(query).sort({ _id: -1 }).limit(limit).exec();
  }

  async softDelete(
    messageId: string,
    senderId: string,
  ): Promise<MessageDocument | null> {
    return this.messageModel.findOneAndUpdate(
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
    return this.messageModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        sender_id: senderId,
        is_deleted: false, // Cannot edit deleted messages
      },
      { content: newContent, is_edited: true },
      { new: true },
    );
  }
}
