import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { RespondFriendRequestDto } from './dto/respond-friend-request.dto';
import { RespondRequestResponseDto } from './dto/respond-request-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  FriendRequestResponseDto,
  PendingRequestResponseDto,
  FriendsListResponseDto,
  SendRequestResponseDto,
} from './dto/friend-response.dto';
import {
  SuccessResponseDto,
  SuccessMessageResponseDto,
} from '../common/dto/success-response.dto';
import {
  PaginatedResponse,
  AuthenticatedUser,
} from '../common/types/response.types';
import { PublicUserProfileDto } from '../user/dto/user-response.dto';

@ApiTags('Friends')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('friend-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send friend request' })
  @ApiResponse({
    status: 201,
    description: 'Friend request sent',
    type: FriendRequestResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  sendRequest(
    @CurrentUser() account: AuthenticatedUser,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<SendRequestResponseDto> {
    return this.friendsService.sendRequest(account.id, dto.receiverId);
  }

  @Get('friend-requests')
  @ApiOperation({ summary: 'Get pending friend requests' })
  @ApiResponse({
    status: 200,
    description: 'List of friend requests',
    type: [PendingRequestResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getPendingRequests(
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<PendingRequestResponseDto[]> {
    return this.friendsService.getPendingRequests(account.id);
  }

  @Patch('friend-requests/:requestId')
  @ApiOperation({ summary: 'Respond to friend request' })
  @ApiResponse({
    status: 200,
    description: 'Responded to friend request',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  respondToRequest(
    @CurrentUser() account: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ): Promise<RespondRequestResponseDto> {
    return this.friendsService.respondToRequest(
      requestId,
      account.id,
      dto.action,
    );
  }

  @Delete('friend-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a sent friend request' })
  @ApiResponse({
    status: 200,
    description: 'Friend request cancelled',
    type: SuccessResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Request already processed' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Friend request not found' })
  cancelRequest(
    @CurrentUser() account: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<SuccessMessageResponseDto> {
    return this.friendsService.cancelRequest(requestId, account.id);
  }

  @Get('friends')
  @ApiOperation({ summary: 'Get friends list' })
  @ApiResponse({
    status: 200,
    description: 'List of friends',
    type: FriendsListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getFriends(
    @CurrentUser() account: AuthenticatedUser,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<PublicUserProfileDto>> {
    return this.friendsService.getFriends(
      account.id,
      pagination.limit,
      pagination.offset,
    );
  }

  @Delete('friends/:accountId')
  @ApiOperation({ summary: 'Remove a friend' })
  @ApiResponse({
    status: 200,
    description: 'Friend removed',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  removeFriend(
    @CurrentUser() account: AuthenticatedUser,
    @Param('accountId') targetId: string,
  ): Promise<SuccessMessageResponseDto> {
    return this.friendsService.removeFriend(account.id, targetId);
  }
}
