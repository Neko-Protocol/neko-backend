import { IsOptional, IsString } from "class-validator";

export class CreateInvitationDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  assigned_to?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  expires_days?: number;

  @IsOptional()
  @IsString()
  strategy_id?: string;
}
