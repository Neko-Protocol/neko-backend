import { IsOptional, IsString } from "class-validator";

export class CreateMailingBroadcastDto {
  @IsString()
  name!: string;

  @IsString()
  subject!: string;

  @IsString()
  body_html!: string;

  @IsOptional()
  @IsString()
  audience?: string;
}
