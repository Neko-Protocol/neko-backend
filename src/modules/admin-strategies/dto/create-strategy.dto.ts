import { IsOptional, IsString } from "class-validator";

export class CreateStrategyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
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
  assigned_to?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
