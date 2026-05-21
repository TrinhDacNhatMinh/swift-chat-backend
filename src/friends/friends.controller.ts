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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBadRequestResponse, ApiUnauthorizedResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { RespondFriendRequestDto } from './dto/respond-friend-request.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { FriendRequestResponseDto, PendingRequestResponseDto, FriendsListResponseDto } from './dto/friend-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';

@ApiTags('Friends')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('friend-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send friend request' })
  @ApiResponse({ status: 201, description: 'Friend request sent', type: FriendRequestResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  sendRequest(@CurrentUser() user: any, @Body() dto: CreateFriendRequestDto) {
    return this.friendsService.sendRequest(user.id, dto.receiverId);
  }

  @Get('friend-requests')
  @ApiOperation({ summary: 'Get pending friend requests' })
  @ApiResponse({ status: 200, description: 'List of friend requests', type: [PendingRequestResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getPendingRequests(@CurrentUser() user: any) {
    return this.friendsService.getPendingRequests(user.id);
  }

  @Patch('friend-requests/:requestId')
  @ApiOperation({ summary: 'Respond to friend request' })
  @ApiResponse({ status: 200, description: 'Responded to friend request', type: SuccessResponseDto })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  respondToRequest(
    @CurrentUser() user: any,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.respondToRequest(requestId, user.id, dto.action);
  }

  @Get('friends')
  @ApiOperation({ summary: 'Get friends list' })
  @ApiResponse({ status: 200, description: 'List of friends', type: FriendsListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getFriends(@CurrentUser() user: any, @Query() pagination: PaginationDto) {
    return this.friendsService.getFriends(
      user.id,
      pagination.limit,
      pagination.offset,
    );
  }

  @Delete('friends/:userId')
  @ApiOperation({ summary: 'Remove a friend' })
  @ApiResponse({ status: 200, description: 'Friend removed', type: SuccessResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  removeFriend(@CurrentUser() user: any, @Param('userId') targetId: string) {
    return this.friendsService.removeFriend(user.id, targetId);
  }
}
