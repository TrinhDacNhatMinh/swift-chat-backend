import { ApiProperty } from '@nestjs/swagger';

export class ConversationMemberDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  accountId: string;

  @ApiProperty({ enum: ['leader', 'deputy', 'member'] })
  role: string;

  @ApiProperty()
  joinAt: Date;

  @ApiProperty()
  handle: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;
}
