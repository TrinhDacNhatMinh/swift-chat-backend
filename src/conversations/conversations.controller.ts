import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { TransferRoleDto } from './dto/transfer-role.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TransferLeadershipDto } from './dto/transfer-leadership.dto';
import { ConversationResponseDto, ConversationListResponseDto, ReadReceiptResponseDto } from './dto/conversation-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  // ─── Conversation CRUD ──────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new conversation' })
  @ApiResponse({ status: 201, description: 'Conversation created', type: ConversationResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(@CurrentUser() user: any, @Body() dto: CreateConversationDto) {
    return this.conversationsService.createConversation(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all conversations for current user' })
  @ApiResponse({ status: 200, description: 'List of conversations', type: ConversationListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  findAll(@CurrentUser() user: any, @Query() pagination: PaginationDto) {
    return this.conversationsService.getUserConversations(
      user.id,
      pagination.limit,
      pagination.offset,
    );
  }

  /**
   * Smart delete for a conversation:
   * - Group  → disband (soft-delete). Leader only.
   * - Direct → hide for the caller only. The other participant is unaffected.
   *            If a new message arrives, the conversation re-appears automatically.
   * DELETE /conversations/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete or leave a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation deleted/left', type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  deleteConversation(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.deleteConversation(user.id, conversationId);
  }

  // ─── Group Info ─────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update group conversation info' })
  @ApiResponse({ status: 200, description: 'Group info updated', type: ConversationResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  updateGroupInfo(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.conversationsService.updateGroupInfo(user.id, conversationId, dto);
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add members to group' })
  @ApiResponse({ status: 200, description: 'Members added', type: SuccessResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  addMembers(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversationsService.addMembers(user.id, conversationId, dto.userIds);
  }

  /**
   * Leave the group yourself.
   * Leader must transfer leadership or disband before leaving if others still exist.
   * DELETE /conversations/:id/members/me
   */
  @Delete(':id/members/me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave the group' })
  @ApiResponse({ status: 200, description: 'Left group', type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  leaveGroup(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.leaveGroup(user.id, conversationId);
  }

  /**
   * Kick another member from the group.
   * Leader can kick anyone; Deputy can only kick Members.
   * DELETE /conversations/:id/members/:userId
   */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kick member from group' })
  @ApiResponse({ status: 200, description: 'Member kicked', type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  kickMember(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversationsService.kickMember(user.id, conversationId, targetUserId);
  }

  // ─── Role Management ────────────────────────────────────────────────────────

  /**
   * Promote a Member to Deputy, or demote a Deputy back to Member.
   * Only the Leader can do this.
   * PATCH /conversations/:id/members/:userId/role
   */
  @Patch(':id/members/:userId/role')
  @ApiOperation({ summary: 'Update member role (promote/demote)' })
  @ApiResponse({ status: 200, description: 'Role updated', type: SuccessResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  updateMemberRole(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: TransferRoleDto,
  ) {
    return this.conversationsService.updateMemberRole(user.id, conversationId, targetUserId, dto.role);
  }

  /**
   * Transfer leadership to another member (atomic: old leader becomes Member).
   * Only the current Leader can do this.
   * POST /conversations/:id/transfer-leadership
   */
  @Post(':id/transfer-leadership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer group leadership' })
  @ApiResponse({ status: 200, description: 'Leadership transferred', type: SuccessResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  transferLeadership(
    @CurrentUser() user: any,
    @Param('id') conversationId: string,
    @Body() dto: TransferLeadershipDto,
  ) {
    return this.conversationsService.transferLeadership(user.id, conversationId, dto.newLeaderId);
  }

  // ─── Read Receipts ──────────────────────────────────────────────────────────

  @Get(':conversationId/read-receipts')
  @ApiOperation({ summary: 'Get read receipts for conversation' })
  @ApiResponse({ status: 200, description: 'List of read receipts', type: [ReadReceiptResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async getReadReceipts(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
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
