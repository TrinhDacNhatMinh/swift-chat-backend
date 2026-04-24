import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Post,
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
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SearchUsersQueryDto, SearchScope } from './dto/search-users-query.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  UserResponseDto,
  SearchUserResponseDto,
  PublicUserProfileDto,
} from './dto/user-response.dto';
import {
  AuthenticatedUser,
  SuccessResponse,
} from '../common/types/response.types';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current account profile' })
  @ApiResponse({
    status: 200,
    description: 'Current account profile',
    type: UserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getProfile(
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.userService.getUserProfile(account.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current account profile' })
  @ApiResponse({
    status: 200,
    description: 'Updated account profile',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Bad Request' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  updateProfile(
    @CurrentUser() account: AuthenticatedUser,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.userService.updateProfile(account.id, updateProfileDto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users by handle' })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: [SearchUserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  searchUsers(
    @Query() searchDto: SearchUsersQueryDto,
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<SearchUserResponseDto[]> {
    return this.userService.searchByHandle(
      searchDto.q,
      searchDto.scope || SearchScope.ALL,
      account.id,
    );
  }

  @Get('handle/:handle')
  @ApiOperation({ summary: 'Get account profile by handle' })
  @ApiResponse({
    status: 200,
    description: 'User profile',
    type: PublicUserProfileDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getUserProfileByHandle(
    @Param('handle') handle: string,
  ): Promise<PublicUserProfileDto> {
    const profile = await this.userService.getUserProfileByHandle(handle);

    return {
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      bio: profile.bio,
      website: profile.website,
      location: profile.location,
      lastSeen: profile.lastSeen,
      createdAt: profile.createdAt,
    };
  }

  @Get(':accountId')
  @ApiOperation({ summary: 'Get account profile by ID' })
  @ApiResponse({
    status: 200,
    description: 'User profile',
    type: PublicUserProfileDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getUserProfile(
    @Param('accountId') accountId: string,
  ): Promise<PublicUserProfileDto> {
    const profile = await this.userService.getUserProfile(accountId);

    return {
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      bio: profile.bio,
      website: profile.website,
      location: profile.location,
      lastSeen: profile.lastSeen,
      createdAt: profile.createdAt,
    };
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change password for current account (local auth only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
  })
  @ApiBadRequestResponse({
    description: 'Bad Request (OAuth account or same password)',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized or incorrect current password',
  })
  changePassword(
    @CurrentUser() account: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<SuccessResponse> {
    return this.userService.changePassword(
      account.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
