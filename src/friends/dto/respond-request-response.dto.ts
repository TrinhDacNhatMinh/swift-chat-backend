import { ApiProperty } from '@nestjs/swagger';

export class RespondRequestResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'accepted',
    description: 'Action performed on the friend request',
  })
  action: 'accepted' | 'rejected';

  @ApiProperty({ example: 'uuid', description: 'ID of the friend request' })
  requestId: string;
}
