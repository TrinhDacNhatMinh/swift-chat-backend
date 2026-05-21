import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { MessageListResponseDto } from './dto/message-response.dto';
import { ConversationsService } from '../conversations/conversations.service';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiResponse({ status: 200, description: 'List of messages', type: MessageListResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden (Not a member of the conversation)' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async findAll(
    @CurrentUser() user: { id: string },
    @Param('conversationId') conversationId: string,
    @Query() dto: GetMessagesDto,
  ) {
    const isMember = await this.conversationsService.isParticipant(
      user.id,
      conversationId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    return this.messagesService.findByConversation(
      conversationId,
      dto.cursor,
      dto.limit,
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Search messages in a conversation' })
  @ApiResponse({ status: 200, description: 'Search results', type: MessageListResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden (Not a member of the conversation)' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async searchMessages(
    @CurrentUser() user: { id: string },
    @Param('conversationId') conversationId: string,
    @Query() dto: SearchMessagesDto,
  ) {
    const isMember = await this.conversationsService.isParticipant(
      user.id,
      conversationId,
    );
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    return this.messagesService.searchMessages(
      conversationId,
      dto.q,
      dto.cursor,
      dto.limit,
    );
  }
}
