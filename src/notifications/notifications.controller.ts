import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UnreadCountResponseDto } from './dto/notification-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';
import { AuthenticatedUser } from '../common/types/response.types';
import { NotificationResponseDto } from './dto/notification-response.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications' })
  @ApiResponse({
    status: 200,
    description: 'List of notifications',
    type: [NotificationResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getNotifications(
    @CurrentUser() account: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<NotificationResponseDto[]> {
    return this.notificationsService.getUserNotifications(
      account.id,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notifications count' })
  @ApiResponse({
    status: 200,
    description: 'Unread count',
    type: UnreadCountResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getUnreadCount(
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<UnreadCountResponseDto> {
    const result = await this.notificationsService.getUnreadCount(account.id);
    return { unreadCount: result.count };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({
    status: 200,
    description: 'All notifications marked as read',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async markAllAsRead(
    @CurrentUser() account: AuthenticatedUser,
  ): Promise<SuccessResponseDto> {
    await this.notificationsService.markAllAsRead(account.id);
    return { success: true };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiNotFoundResponse({ description: 'Not Found' })
  async markAsRead(
    @CurrentUser() account: AuthenticatedUser,
    @Param('id') notificationId: string,
  ): Promise<SuccessResponseDto> {
    await this.notificationsService.markAsRead(notificationId, account.id);
    return { success: true };
  }
}
