import { Controller, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SearchUsersDto } from './dto/search-users.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return this.userService.getUserProfile(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: any, @Body() updateProfileDto: UpdateProfileDto) {
    return this.userService.updateProfile(user.id, updateProfileDto);
  }

  @Get()
  searchUsers(@Query() searchUsersDto: SearchUsersDto, @CurrentUser() user: any) {
    return this.userService.searchUsers(searchUsersDto.query, user.id);
  }

  @Get(':userId')
  getUserProfile(@Param('userId') userId: string) {
    return this.userService.getUserProfile(userId);
  }
}
