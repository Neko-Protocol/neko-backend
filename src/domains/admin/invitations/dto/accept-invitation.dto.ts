import { IsOptional, IsString } from "class-validator";

export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  accepted_notes?: string;

  @IsOptional()
  volume_moved?: number | string | null;
}
