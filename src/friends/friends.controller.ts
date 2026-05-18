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
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { RespondFriendRequestDto } from './dto/respond-friend-request.dto';
import { PaginationDto } from './dto/pagination.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('friend-requests')
  @HttpCode(HttpStatus.CREATED)
  sendRequest(@CurrentUser() user: any, @Body() dto: CreateFriendRequestDto) {
    return this.friendsService.sendRequest(user.id, dto.receiverId);
  }

  @Get('friend-requests')
  getPendingRequests(@CurrentUser() user: any) {
    return this.friendsService.getPendingRequests(user.id);
  }

  @Patch('friend-requests/:requestId')
  respondToRequest(
    @CurrentUser() user: any,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.respondToRequest(requestId, user.id, dto.action);
  }

  @Get('friends')
  getFriends(@CurrentUser() user: any, @Query() pagination: PaginationDto) {
    return this.friendsService.getFriends(
      user.id,
      pagination.limit,
      pagination.offset,
    );
  }

  @Delete('friends/:userId')
  removeFriend(@CurrentUser() user: any, @Param('userId') targetId: string) {
    return this.friendsService.removeFriend(user.id, targetId);
  }
}
