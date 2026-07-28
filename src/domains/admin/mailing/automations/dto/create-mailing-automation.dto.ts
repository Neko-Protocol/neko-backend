import { IsInt, IsObject, IsOptional, IsString, Min } from "class-validator";

export class CreateMailingAutomationDto {
  @IsString()
  name!: string;

  @IsString()
  trigger_type!: string;

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

  @IsString()
  template_id!: string;
}
