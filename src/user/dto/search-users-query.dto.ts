import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SearchScope {
  ALL = 'all',
  FRIENDS = 'friends',
}

export class SearchUsersQueryDto {
  @ApiProperty({ description: 'Handle to search for', required: true })
  @IsString()
  q: string;

  @ApiProperty({
    description: 'Search scope',
    enum: SearchScope,
    required: false,
    default: SearchScope.ALL,
  })
  @IsOptional()
  @IsEnum(SearchScope)
  scope?: SearchScope = SearchScope.ALL;
}
