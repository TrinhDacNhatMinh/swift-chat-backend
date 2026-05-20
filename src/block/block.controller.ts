import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
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
  ApiConflictResponse,
} from '@nestjs/swagger';
import { BlockService } from './block.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/response.types';
import {
  BlockResponseDto,
  BlockedUserResponseDto,
  BlockStatusResponseDto,
} from './dto/block-response.dto';

@ApiTags('Block')
@ApiBearerAuth()
@Controller('block')
@UseGuards(JwtAuthGuard)
export class BlockController {
  constructor(private readonly blockService: BlockService) {}

  @Post(':targetUserId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user' })
  @ApiResponse({
    status: 200,
    description: 'User blocked successfully',
    type: BlockResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Cannot block yourself' })
  @ApiConflictResponse({ description: 'User already blocked' })
  @ApiNotFoundResponse({ description: 'Target account not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  blockUser(
    @CurrentUser() account: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ): Promise<BlockResponseDto> {
    return this.blockService.blockUser(account.id, targetUserId);
  }

  @Delete(':targetUserId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock a user' })
  @ApiResponse({
    status: 200,
    description: 'User unblocked successfully',
    type: BlockResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Block record not found' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  unblockUser(
    @CurrentUser() account: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ): Promise<BlockResponseDto> {
    return this.blockService.unblockUser(account.id, targetUserId);
  }

  @Get()
  @ApiOperation({ summary: 'Get list of blocked users' })
  @ApiResponse({
    status: 200,
    description: 'List of blocked users',
    type: [BlockedUserResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getBlockedUsers(
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<BlockedUserResponseDto[]> {
    return this.blockService.getBlockedUsers(account.id);
  }

  @Get('status/:targetUserId')
  @ApiOperation({ summary: 'Get block status with a user' })
  @ApiResponse({
    status: 200,
    description: 'Block status with the user',
    type: BlockStatusResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getBlockStatus(
    @CurrentUser() account: AuthenticatedUser,
    @Param('targetUserId') targetUserId: string,
  ): Promise<BlockStatusResponseDto> {
    return this.blockService.getBlockStatus(account.id, targetUserId);
  }
}
