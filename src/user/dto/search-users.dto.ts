import { IsString, MinLength } from 'class-validator';

export class SearchUsersDto {
  @IsString()
  @MinLength(1)
  query: string;
}
