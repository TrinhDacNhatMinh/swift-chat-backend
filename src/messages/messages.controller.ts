import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { GlobalSearchMessagesDto } from './dto/global-search-messages.dto';
import {
  MessageResponseDto,
  MessageListResponseDto,
} from './dto/message-response.dto';
import { ConversationsService } from '../conversations/conversations.service';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiResponse({
    status: 200,
    description: 'List of messages',
    type: MessageListResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({
    description: 'Forbidden (Not a member of the conversation)',
  })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async findAll(
    @CurrentUser() account: { id: string },
    @Param('conversationId') conversationId: string,
    @Query() dto: GetMessagesDto,
  ): Promise<MessageResponseDto[]> {
    return this.messagesService.findByConversation(
      conversationId,
      account.id,
      dto.cursor,
      dto.limit,
    );
  }

  @Get('messages/search')
  @ApiOperation({
    summary: 'Search messages globally or in a specific conversation',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results',
    type: MessageListResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({
    description: 'Forbidden (Not a member of the conversation)',
  })
  async searchMessages(
    @CurrentUser() account: { id: string },
    @Query() dto: GlobalSearchMessagesDto,
  ): Promise<MessageResponseDto[]> {
    return this.messagesService.globalSearch(
      dto.q,
      account.id,
      dto.conversationId,
      dto.cursor,
      dto.limit,
    );
  }
}
