import { IsString } from "class-validator";

export class CreateMailingTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  subject!: string;

  @IsString()
  body_html!: string;
}
