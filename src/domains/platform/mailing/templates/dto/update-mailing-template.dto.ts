import { IsOptional, IsString } from "class-validator";

export class UpdateMailingTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body_html?: string;
}
