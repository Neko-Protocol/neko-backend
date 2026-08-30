import {
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class CreateMailingMessageDto {
  /** "broadcast" (send once) or "automation" (triggered). */
  @IsString()
  kind!: string;

  @IsString()
  name!: string;

  /** Content: either a template reference, or inline subject + body. */
  @IsOptional()
  @IsString()
  template_id?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body_html?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  /** Required for automations, rejected on broadcasts. */
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

  /** Acting admin's email; stored only if it matches an active admin_emails row. */
  @IsOptional()
  @IsEmail()
  created_by?: string;
}
