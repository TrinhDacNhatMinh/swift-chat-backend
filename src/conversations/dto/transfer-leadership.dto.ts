import { IsUUID } from 'class-validator';

export class TransferLeadershipDto {
  @IsUUID()
  newLeaderId: string;
}
