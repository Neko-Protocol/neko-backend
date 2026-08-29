import { IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";

export class UpdateMailingAutomationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  trigger_type?: string;

  @IsOptional()
  @IsObject()
  trigger_params?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  delay_value?: number;

  @IsOptional()
  @IsString()
  delay_unit?: string;

  @IsOptional()
  @IsString()
  segment?: string;

  @IsOptional()
  @IsString()
  template_id?: string;
}
