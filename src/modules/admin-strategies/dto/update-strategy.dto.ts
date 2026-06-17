import { IsOptional, IsString } from "class-validator";

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  description?: string | null;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  target_count?: number;

  @IsOptional()
  target_volume?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  assigned_to?: string | null;

  @IsOptional()
  completed_at?: string | null;
}
