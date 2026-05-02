import { IsArray, IsUUID } from 'class-validator';

export class AddMembersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds: string[];
}
