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
} from '@nestjs/common';
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
import { ConversationsService } from './conversations.service';
import { GroupMemberService } from './group-member.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { TransferRoleDto } from './dto/transfer-role.dto';
import { TransferLeadershipDto } from './dto/transfer-leadership.dto';
import { ConversationMemberDto } from './dto/conversation-member-response.dto';
import { MuteConversationDto } from './dto/mute-conversation.dto';
import {
  ConversationResponseDto,
  ReadReceiptResponseDto,
  AddMembersResponseDto,
  KickMemberResponseDto,
  DisbandGroupResponseDto,
  TransferLeadershipResponseDto,
  UpdateMemberRoleResponseDto,
  HideConversationResponseDto,
  ReadReceiptItemDto,
  ConversationWithParticipantsDto,
  ConversationListItemDto,
} from './dto/conversation-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';
import {
  CursorPaginatedResponse,
  AuthenticatedUser,
} from '../common/types/response.types';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly groupMemberService: GroupMemberService,
  ) {}

  // ─── Conversation CRUD ──────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new conversation' })
  @ApiResponse({
    status: 201,
    description: 'Conversation created',
    type: ConversationWithParticipantsDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  create(
    @CurrentUser() account: AuthenticatedUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationWithParticipantsDto> {
    return this.conversationsService.createConversation(account.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get conversations for current user (cursor-based)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cursor-paginated list of conversations',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  findAll(
    @CurrentUser() account: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ): Promise<CursorPaginatedResponse<ConversationListItemDto>> {
    return this.conversationsService.getUserConversations(
      account.id,
      limit ? Math.min(parseInt(limit, 10) || 20, 50) : 20,
      cursor,
      q ?? '',
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
  @ApiResponse({
    status: 200,
    description: 'Conversation deleted/left',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async deleteConversation(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
  ): Promise<
    SuccessResponseDto | HideConversationResponseDto | DisbandGroupResponseDto
  > {
    const type =
      await this.conversationsService.getConversationType(conversationId);
    if (type === 'GROUP' || type === 'group') {
      return this.groupMemberService.disbandGroup(account.id, conversationId);
    }
    return this.conversationsService.hideDirectConversation(
      account.id,
      conversationId,
    );
  }

  // ─── Group Info ─────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update group conversation info' })
  @ApiResponse({
    status: 200,
    description: 'Group info updated',
    type: ConversationResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  updateGroupInfo(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<ConversationResponseDto> {
    return this.groupMemberService.updateGroupInfo(
      account.id,
      conversationId,
      dto,
    );
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'Get list of members in a conversation' })
  @ApiResponse({
    status: 200,
    description: 'List of members',
    type: [ConversationMemberDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  getMembers(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
  ): Promise<ConversationMemberDto[]> {
    return this.conversationsService.getMembers(account.id, conversationId);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add members to group' })
  @ApiResponse({
    status: 200,
    description: 'Members added',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  addMembers(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: AddMembersDto,
  ): Promise<AddMembersResponseDto> {
    return this.groupMemberService.addMembers(
      account.id,
      conversationId,
      dto.userIds,
    );
  }

  /**
   * Leave the group yourself.
   * Leader must transfer leadership or disband before leaving if others still exist.
   * DELETE /conversations/:id/members/me
   */
  @Delete(':id/members/me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave the group' })
  @ApiResponse({
    status: 200,
    description: 'Left group',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  leaveGroup(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
  ): Promise<SuccessResponseDto> {
    return this.groupMemberService.leaveGroup(account.id, conversationId);
  }

  /**
   * Kick another member from the group.
   * Leader can kick anyone; Deputy can only kick Members.
   * DELETE /conversations/:id/members/:accountId
   */
  @Delete(':id/members/:accountId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kick member from group' })
  @ApiResponse({
    status: 200,
    description: 'Member kicked',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  kickMember(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Param('accountId') targetUserId: string,
  ): Promise<KickMemberResponseDto> {
    return this.groupMemberService.kickMember(
      account.id,
      conversationId,
      targetUserId,
    );
  }

  // ─── Role Management ────────────────────────────────────────────────────────

  /**
   * Promote a Member to Deputy, or demote a Deputy back to Member.
   * Only the Leader can do this.
   * PATCH /conversations/:id/members/:accountId/role
   */
  @Patch(':id/members/:accountId/role')
  @ApiOperation({ summary: 'Update member role (promote/demote)' })
  @ApiResponse({
    status: 200,
    description: 'Role updated',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  updateMemberRole(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Param('accountId') targetUserId: string,
    @Body() dto: TransferRoleDto,
  ): Promise<UpdateMemberRoleResponseDto> {
    return this.groupMemberService.updateMemberRole(
      account.id,
      conversationId,
      targetUserId,
      dto.role,
    );
  }

  /**
   * Transfer leadership to another member (atomic: old leader becomes Member).
   * Only the current Leader can do this.
   * PATCH /conversations/:id/transfer-leadership
   */
  @Patch(':id/transfer-leadership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer group leadership' })
  @ApiResponse({
    status: 200,
    description: 'Leadership transferred',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  transferLeadership(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: TransferLeadershipDto,
  ): Promise<TransferLeadershipResponseDto> {
    return this.groupMemberService.transferLeadership(
      account.id,
      conversationId,
      dto.newLeaderId,
    );
  }

  // ─── Mute Conversation ──────────────────────────────────────────────────────

  @Post(':id/mute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mute a conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation muted successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  muteConversation(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: MuteConversationDto,
  ): Promise<SuccessResponseDto> {
    return this.conversationsService.muteConversation(
      account.id,
      conversationId,
      dto.duration as any,
    );
  }

  @Delete(':id/mute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unmute a conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation unmuted successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  unmuteConversation(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') conversationId: string,
  ): Promise<SuccessResponseDto> {
    return this.conversationsService.unmuteConversation(
      account.id,
      conversationId,
    );
  }

  // ─── Read Receipts ──────────────────────────────────────────────────────────

  @Get(':conversationId/read-receipts')
  @ApiOperation({ summary: 'Get read receipts for conversation' })
  @ApiResponse({
    status: 200,
    description: 'List of read receipts',
    type: [ReadReceiptResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async getReadReceipts(
    @CurrentUser() account: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<ReadReceiptItemDto[]> {
    return this.conversationsService.getReadReceipts(
      account.id,
      conversationId,
    );
  }
}
