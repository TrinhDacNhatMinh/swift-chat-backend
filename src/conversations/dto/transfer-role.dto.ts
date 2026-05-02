import { IsEnum } from 'class-validator';
import { ParticipantRole } from '../enums/conversation.enum';

export class TransferRoleDto {
  @IsEnum(ParticipantRole)
  role: ParticipantRole;
}
