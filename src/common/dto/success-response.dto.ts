import { ApiProperty } from '@nestjs/swagger';

export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}

export class SuccessMessageResponseDto extends SuccessResponseDto {
  @ApiProperty({ example: 'Operation successful' })
  message: string;
}

export class CountResponseDto {
  @ApiProperty({ example: 10 })
  count: number;
}
