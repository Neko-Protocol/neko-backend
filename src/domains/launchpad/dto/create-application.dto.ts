import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO31661Alpha2,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { AssetType, OfferingType } from "../launchpad.types";
import { ApplicationDocumentDto } from "./application-document.dto";
import { ApplicationMilestoneDto } from "./application-milestone.dto";

const ASSET_TYPES = [
  "real_estate",
  "private_credit",
  "invoices",
  "agriculture",
  "energy",
  "other",
] as const;

const OFFERING_TYPES = ["private", "public"] as const;

export class CreateApplicationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  issuer_name!: string;

  @ApiProperty({ description: "ISO 3166-1 alpha-2 country code." })
  @IsISO31661Alpha2()
  issuer_country!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  asset_name!: string;

  @ApiProperty({ enum: ASSET_TYPES })
  @IsIn(ASSET_TYPES)
  asset_type!: AssetType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  description!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  target_amount!: number;

  @ApiProperty({ default: "USD" })
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  min_ticket!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  expected_yield_pct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  term_months?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  max_investors?: number;

  @ApiProperty({ enum: OFFERING_TYPES, default: "private" })
  @IsIn(OFFERING_TYPES)
  offering_type!: OfferingType;

  @ApiProperty({ type: [String], description: "ISO 3166-1 alpha-2 codes." })
  @IsArray()
  @ArrayMaxSize(30)
  @IsISO31661Alpha2({ each: true })
  investor_countries!: string[];

  @ApiProperty()
  @IsBoolean()
  accepts_us_investors!: boolean;

  @ApiProperty()
  @IsBoolean()
  uses_mass_marketing!: boolean;

  @ApiProperty({ type: [ApplicationMilestoneDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ApplicationMilestoneDto)
  milestones!: ApplicationMilestoneDto[];

  @ApiProperty({ type: [ApplicationDocumentDto] })
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ApplicationDocumentDto)
  documents!: ApplicationDocumentDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  ai_summary?: string;
}
