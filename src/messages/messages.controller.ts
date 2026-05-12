import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GetMessagesDto } from './dto/get-messages.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(
    @CurrentUser() user: { id: string },
    @Param('conversationId') conversationId: string,
    @Query() dto: GetMessagesDto,
  ) {
    // Verify user is a participant of this conversation
    const participant = await this.prisma.participant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: user.id,
        },
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    return this.messagesService.findByConversation(
      conversationId,
      dto.cursor,
      dto.limit,
    );
  }
}
