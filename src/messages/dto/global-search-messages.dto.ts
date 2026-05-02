import {
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GlobalSearchMessagesDto {
  @ApiProperty({ description: 'Keyword to search for', required: true })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiProperty({
    description: 'Specific conversation ID to search in',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({
    description: 'Cursor for pagination (ObjectId)',
    required: false,
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({
    description: 'Number of results to return',
    required: false,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
