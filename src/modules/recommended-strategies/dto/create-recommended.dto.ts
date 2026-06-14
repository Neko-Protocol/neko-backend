import { IsOptional, IsString } from "class-validator";

/** Loose by design — the service performs the field-level validation that the
 * original admin route did inline. */
export class CreateRecommendedDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  description?: string | null;

  @IsOptional()
  @IsString()
  token_code?: string;

  @IsOptional()
  @IsString()
  destination_kind?: string;

  @IsOptional()
  @IsString()
  destination_id?: string;

  @IsOptional()
  stack_kind?: string | null;

  @IsOptional()
  stack_id?: string | null;

  @IsOptional()
  amount?: number | string | null;

  @IsOptional()
  snapshot_apy?: number | string | null;

  @IsOptional()
  position?: number | string;

  @IsOptional()
  is_active?: boolean;
}

export class UpdateRecommendedDto extends CreateRecommendedDto {}
