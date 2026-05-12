import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: any, @Body() dto: CreateConversationDto) {
    return this.conversationsService.createConversation(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.conversationsService.getUserConversations(user.id);
  }
}
