import { IsEmail, IsOptional, IsString } from "class-validator";

export class CreateMailingTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  subject!: string;

  @IsString()
  body_html!: string;

  /** Acting admin's email; stored only if it matches an active admin_emails row. */
  @IsOptional()
  @IsEmail()
  created_by?: string;
}
