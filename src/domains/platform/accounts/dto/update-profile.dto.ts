import { ApiPropertyOptional } from "@nestjs/swagger";
import type { UpdateProfileRequest } from "@neko-protocol/api-contracts";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdateProfileDto implements UpdateProfileRequest {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  display_name?: string;

  @ApiPropertyOptional({ description: "ISO 3166-1 alpha-2, e.g. CR" })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @ApiPropertyOptional({ enum: ["en", "es"] })
  @IsOptional()
  @IsIn(["en", "es"])
  locale?: string;

  @ApiPropertyOptional({
    description: "Version of the accepted terms; sets terms_accepted_at.",
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  terms_version?: string;
}
