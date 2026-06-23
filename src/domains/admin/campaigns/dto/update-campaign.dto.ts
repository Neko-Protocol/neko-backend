import { IsOptional, IsString } from "class-validator";

export class UpdateCampaignDto {
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
  segment?: string;
}

export class UpdateCampaignTvlDto {
  @IsOptional()
  tvl_moved?: number | string | null;
}
