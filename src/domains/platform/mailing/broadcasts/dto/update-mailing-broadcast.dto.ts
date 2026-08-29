import { IsOptional, IsString } from "class-validator";

export class UpdateMailingBroadcastDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body_html?: string;

  @IsOptional()
  @IsString()
  audience?: string;
}
