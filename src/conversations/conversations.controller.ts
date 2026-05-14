import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PaginationDto } from './dto/pagination.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: any, @Body() dto: CreateConversationDto) {
    return this.conversationsService.createConversation(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() pagination: PaginationDto) {
    return this.conversationsService.getUserConversations(
      user.id,
      pagination.limit,
      pagination.offset,
    );
  }

  @Get(':conversationId/read-receipts')
  async getReadReceipts(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    // Fix #1: Verify user is a participant before exposing read receipts
    const isMember = await this.conversationsService.isParticipant(
      user.id,
      conversationId,
    );
    if (!isMember) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }
    return this.conversationsService.getReadReceipts(conversationId);
  }
}
