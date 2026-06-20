import { IsOptional, IsString } from "class-validator";

export class CreateCampaignDto {
  @IsString()
  name!: string;

  @IsString()
  subject!: string;

  @IsString()
  body_html!: string;

  @IsOptional()
  @IsString()
  segment?: string;
}
