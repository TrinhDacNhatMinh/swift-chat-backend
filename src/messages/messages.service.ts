import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, PipelineStage } from 'mongoose';
import {
  Message,
  MessageArchive,
  MessageDocument,
  MessageType,
  ReplyTarget,
} from './schemas/message.schema';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(MessageArchive.name)
    private readonly messageArchiveModel: Model<MessageDocument>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
  ) {}

  async create(
    senderId: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    let replyTo: ReplyTarget | null = null;
    let forwardedFrom: { messageId: string; senderId: string } | null = null;
    let content = dto.content;

    if (dto.replyToMessageId) {
      const originalMessage = await this.messageModel.findById(
        dto.replyToMessageId,
      );
      if (
        originalMessage &&
        originalMessage.conversation_id === dto.conversationId
      ) {
        if (
          originalMessage.deleted_by &&
          originalMessage.deleted_by.includes(senderId)
        ) {
          throw new BadRequestException(
            'Cannot reply to a message you have deleted',
          );
        }

        replyTo = {
          messageId: originalMessage._id.toString(),
          senderId: originalMessage.sender_id,
          content: originalMessage.is_unsent ? '' : originalMessage.content,
          type: originalMessage.type,
        };
      }
    }

    if (dto.forwardFromMessageId) {
      let originalMessage = await this.messageModel.findById(
        dto.forwardFromMessageId,
      );
      if (!originalMessage) {
        originalMessage = await this.messageArchiveModel.findById(
          dto.forwardFromMessageId,
        );
      }

      if (originalMessage && !originalMessage.is_unsent) {
        forwardedFrom = {
          messageId: originalMessage._id.toString(),
          senderId: originalMessage.sender_id,
        };
        content = originalMessage.content;
      } else {
        throw new BadRequestException('Cannot forward this message');
      }
    }

    const message = new this.messageModel({
      conversation_id: dto.conversationId,
      sender_id: senderId,
      content: content || '',
      type: dto.type || MessageType.TEXT,
      reply_to: replyTo,
      mentions: dto.mentions || [],
      attachments: dto.attachments || [],
      forwarded_from: forwardedFrom,
    });

    const saved = await message.save();
    return this.toDto(saved);
  }

  async findByConversation(
    conversationId: string,
    currentUserId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<MessageResponseDto[]> {
    const isMember = await this.conversationsService.isParticipant(
      currentUserId,
      conversationId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const query: Record<string, unknown> = {
      conversation_id: conversationId,
      deleted_by: { $ne: currentUserId },
    };

    let useArchive = false;

    if (cursor) {
      const cursorObjectId = new Types.ObjectId(cursor);
      query._id = { $lt: cursorObjectId };

      const archiveDays = this.configService.get<number>(
        'MESSAGE_ARCHIVE_DAYS',
        30,
      );
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - archiveDays);

      if (cursorObjectId.getTimestamp() < cutoffDate) {
        useArchive = true;
      }
    }

    const model = useArchive ? this.messageArchiveModel : this.messageModel;

    let results = await model.find(query).sort({ _id: -1 }).limit(limit).exec();

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

    const maskedResults = await this.maskDeletedReplies(results, currentUserId);

    return maskedResults.map((msg) => this.toDto(msg));
  }

  async globalSearch(
    keyword: string,
    currentUserId: string,
    conversationId?: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<MessageResponseDto[]> {
    let conversationIds: string[] = [];

    if (conversationId) {
      const isMember = await this.conversationsService.isParticipant(
        currentUserId,
        conversationId,
      );
      if (!isMember) {
        throw new ForbiddenException(
          'You are not a member of this conversation',
        );
      }
      conversationIds = [conversationId];
    } else {
      conversationIds =
        await this.conversationsService.getUserConversationIds(currentUserId);
    }

    if (conversationIds.length === 0) {
      return [];
    }

    const query: Record<string, unknown> = {
      conversation_id: { $in: conversationIds },
      deleted_by: { $ne: currentUserId },
      is_unsent: false,
      content: { $regex: keyword, $options: 'i' },
    };

    let useArchiveOnly = false;

    if (cursor) {
      const cursorObjectId = new Types.ObjectId(cursor);
      query._id = { $lt: cursorObjectId };

      const archiveDays = this.configService.get<number>(
        'MESSAGE_ARCHIVE_DAYS',
        30,
      );
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - archiveDays);

      if (cursorObjectId.getTimestamp() < cutoffDate) {
        useArchiveOnly = true;
      }
    }

    let results: MessageDocument[] = [];

    if (useArchiveOnly) {
      const archived = await this.messageArchiveModel
        .find(query)
        .sort({ _id: -1 })
        .limit(limit)
        .exec();
      results = archived;
    } else {
      results = await this.messageModel
        .find(query)
        .sort({ _id: -1 })
        .limit(limit)
        .exec();

      if (results.length < limit) {
        const remaining = limit - results.length;
        const archiveQuery = { ...query };
        if (results.length > 0) {
          archiveQuery._id = { $lt: results[results.length - 1]._id };
        }

        const archiveResults = await this.messageArchiveModel
          .find(archiveQuery)
          .sort({ _id: -1 })
          .limit(remaining)
          .exec();

        results = [
          ...results,
          ...(archiveResults as unknown as MessageDocument[]),
        ];
      }
    }

    const maskedResults = await this.maskDeletedReplies(results, currentUserId);

    return maskedResults.map((msg) => this.toDto(msg));
  }

  async unsendMessage(
    messageId: string,
    senderId: string,
  ): Promise<MessageResponseDto | null> {
    const query = { _id: new Types.ObjectId(messageId), sender_id: senderId };

    const targetMessage = await this.findInBothCollections(query);

    if (!targetMessage) return null;

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - targetMessage.created_at.getTime() > ONE_DAY_MS) {
      throw new Error(
        'You can only unsend a message within 24 hours of sending it',
      );
    }

    const result = await this.updateInBothCollections(
      { _id: new Types.ObjectId(messageId) },
      { is_unsent: true, deleted_at: new Date() },
    );

    if (result) {
      // Bulk update all messages that replied to this one, clearing the snapshot
      await this.messageModel
        .updateMany(
          { 'reply_to.messageId': messageId },
          { $set: { 'reply_to.content': '' } },
        )
        .exec();

      await this.messageArchiveModel
        .updateMany(
          { 'reply_to.messageId': messageId },
          { $set: { 'reply_to.content': '' } },
        )
        .exec();
    }

    return result ? this.toDto(result) : null;
  }

  async deleteForMe(
    messageId: string,
    accountId: string,
  ): Promise<MessageResponseDto | null> {
    const result = await this.updateInBothCollections(
      { _id: new Types.ObjectId(messageId) },
      { $addToSet: { deleted_by: accountId } },
    );
    return result ? this.toDto(result) : null;
  }

  async editMessage(
    messageId: string,
    senderId: string,
    newContent: string,
  ): Promise<MessageResponseDto | null> {
    const query = {
      _id: new Types.ObjectId(messageId),
      sender_id: senderId,
      is_unsent: false, // Cannot edit unsent messages
    };
    const update = { content: newContent, is_edited: true };

    const result = await this.updateInBothCollections(query, update);
    return result ? this.toDto(result) : null;
  }

  async toggleReaction(
    messageId: string,
    accountId: string,
    emoji: string,
  ): Promise<MessageResponseDto | null> {
    let existingMessage = await this.messageModel.findOne({
      _id: new Types.ObjectId(messageId),
      'reactions.accountId': accountId,
    });

    let isArchive = false;

    if (!existingMessage) {
      existingMessage = await this.messageArchiveModel.findOne({
        _id: new Types.ObjectId(messageId),
        'reactions.accountId': accountId,
      });
      if (existingMessage) isArchive = true;
    }

    const model = isArchive ? this.messageArchiveModel : this.messageModel;

    if (existingMessage) {
      const currentReaction = existingMessage.reactions.find(
        (r) => r.accountId === accountId,
      );

      if (currentReaction && currentReaction.emoji === emoji) {
        // Remove reaction (toggle off) - Pull all reactions from this user just in case
        const updated = await model.findOneAndUpdate(
          { _id: new Types.ObjectId(messageId) },
          { $pull: { reactions: { accountId } } },
          { new: true },
        );
        return updated ? this.toDto(updated) : null;
      } else {
        // Update reaction to new emoji
        // First pull any existing reactions from this user to clean up duplicates
        await model.updateOne(
          { _id: new Types.ObjectId(messageId) },
          { $pull: { reactions: { accountId } } },
        );
        // Then push the new reaction
        const updated = await model.findOneAndUpdate(
          { _id: new Types.ObjectId(messageId) },
          {
            $push: {
              reactions: { emoji, accountId, createdAt: new Date() },
            },
          },
          { new: true },
        );
        return updated ? this.toDto(updated) : null;
      }
    } else {
      // Add reaction. Try hot collection first.
      let result = await this.messageModel.findOneAndUpdate(
        { _id: new Types.ObjectId(messageId) },
        {
          $push: {
            reactions: { emoji, accountId, createdAt: new Date() },
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
              reactions: { emoji, accountId, createdAt: new Date() },
            },
          },
          { new: true },
        );
      }

      return result ? this.toDto(result) : null;
    }
  }

  async pinMessage(
    messageId: string,
    accountId: string,
  ): Promise<MessageResponseDto | null> {
    const query = { _id: new Types.ObjectId(messageId) };
    const update = {
      is_pinned: true,
      pinned_by: accountId,
      pinned_at: new Date(),
    };

    const result = await this.updateInBothCollections(query, update);
    return result ? this.toDto(result) : null;
  }

  async unpinMessage(messageId: string): Promise<MessageResponseDto | null> {
    const query = { _id: new Types.ObjectId(messageId) };
    const update = { is_pinned: false, pinned_by: null, pinned_at: null };

    const result = await this.updateInBothCollections(query, update);
    return result ? this.toDto(result) : null;
  }

  public toDto(doc: MessageDocument): MessageResponseDto {
    return {
      id: doc._id.toString(),
      conversationId: doc.conversation_id,
      senderId: doc.sender_id,
      content: doc.content,
      type: doc.type,
      createdAt: doc.created_at.toISOString(),
      updatedAt: doc.updated_at ? doc.updated_at.toISOString() : undefined,
      isUnsent: doc.is_unsent,
      isEdited: doc.is_edited,
      isDeleted: doc.is_deleted,
      isPinned: doc.is_pinned,
      pinnedBy: doc.pinned_by,
      pinnedAt: doc.pinned_at ? doc.pinned_at.toISOString() : null,
      replyTo: doc.reply_to
        ? {
            messageId: doc.reply_to.messageId,
            senderId: doc.reply_to.senderId,
            content: doc.reply_to.content,
            type: doc.reply_to.type,
          }
        : null,
      forwardedFrom: doc.forwarded_from
        ? {
            messageId: doc.forwarded_from.messageId,
            conversationId: (doc.forwarded_from as any).conversationId || '', // Handle missing field if any
          }
        : null,
      reactions:
        doc.reactions?.map((r) => ({
          emoji: r.emoji,
          accountId: r.accountId,
          createdAt: r.createdAt.toISOString(),
        })) || [],
      attachments: doc.attachments || [],
    };
  }

  /**
   * Count unread messages per conversation for a given user.
   * Accepts a map of { conversationId → lastReadMessageId | null }.
   * Returns a map of { conversationId → unreadCount }.
   */
  async countUnreadInConversations(
    currentUserId: string,
    convLastReadMap: Map<string, string | null>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (convLastReadMap.size === 0) return result;

    // Initialize all to 0
    for (const convId of convLastReadMap.keys()) {
      result.set(convId, 0);
    }

    // Build $or conditions for each conversation's unread boundary
    const orConditions = Array.from(convLastReadMap.entries()).map(
      ([conversationId, lastReadMessageId]) => {
        const cond: any = { conversation_id: conversationId };
        if (lastReadMessageId && Types.ObjectId.isValid(lastReadMessageId)) {
          cond._id = { $gt: new Types.ObjectId(lastReadMessageId) };
        }
        return cond;
      },
    );

    const pipeline: PipelineStage[] = [
      {
        $match: {
          $or: orConditions,
          sender_id: { $ne: currentUserId },
          deleted_by: { $ne: currentUserId },
          is_unsent: { $ne: true },
        },
      },
      {
        $group: {
          _id: '$conversation_id',
          count: { $sum: 1 },
        },
      },
    ];

    const counts = await this.messageModel.aggregate(pipeline).exec();
    for (const item of counts) {
      result.set(item._id, item.count);
    }

    return result;
  }

  /**
   * Get the last message for multiple conversations efficiently.
   * Returns a map of { conversationId → MessageResponseDto }.
   */
  async getLastMessagesForConversations(
    currentUserId: string,
    conversationIds: string[],
  ): Promise<Map<string, MessageResponseDto>> {
    const result = new Map<string, MessageResponseDto>();
    if (conversationIds.length === 0) return result;

    const pipeline: PipelineStage[] = [
      {
        $match: {
          conversation_id: { $in: conversationIds },
          deleted_by: { $ne: currentUserId },
        },
      },
      {
        $sort: { _id: -1 },
      },
      {
        $group: {
          _id: '$conversation_id',
          lastMessage: { $first: '$$ROOT' },
        },
      },
    ];

    const aggregated = await this.messageModel.aggregate(pipeline).exec();
    for (const item of aggregated) {
      result.set(item._id, this.toDto(item.lastMessage));
    }

    return result;
  }
  private async maskDeletedReplies(
    results: any[],
    currentUserId: string,
  ): Promise<any[]> {
    const replyIds = results
      .filter((msg) => msg.reply_to)
      .map((msg) => new Types.ObjectId(msg.reply_to!.messageId));

    const deletedReplyIds = new Set<string>();

    if (replyIds.length > 0) {
      const deletedReplies = await this.messageModel
        .find({
          _id: { $in: replyIds },
          $or: [{ deleted_by: currentUserId }, { is_unsent: true }],
        })
        .select('_id')
        .lean()
        .exec();

      deletedReplies.forEach((d) => deletedReplyIds.add(d._id.toString()));

      const deletedArchiveReplies = await this.messageArchiveModel
        .find({
          _id: { $in: replyIds },
          $or: [{ deleted_by: currentUserId }, { is_unsent: true }],
        })
        .select('_id')
        .lean()
        .exec();

      deletedArchiveReplies.forEach((d) =>
        deletedReplyIds.add(d._id.toString()),
      );
    }

    return results.map((msg) => {
      if (msg.is_unsent) {
        msg.content = '';
      }
      if (msg.reply_to && deletedReplyIds.has(msg.reply_to.messageId)) {
        msg.reply_to.content = '';
      }
      return msg;
    });
  }
  private async findInBothCollections(
    query: any,
  ): Promise<MessageDocument | null> {
    let result = await this.messageModel.findOne(query);
    if (!result) {
      result = await this.messageArchiveModel.findOne(query);
    }
    return result;
  }

  private async updateInBothCollections(
    query: any,
    update: any,
    options: any = { new: true },
  ): Promise<MessageDocument | null> {
    let result = await this.messageModel.findOneAndUpdate(
      query,
      update,
      options,
    );
    if (!result) {
      result = await this.messageArchiveModel.findOneAndUpdate(
        query,
        update,
        options,
      );
    }
    return result as unknown as MessageDocument | null;
  }
}
