import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import type { ReferralPartnerType } from "@neko/api-contracts";

export class CreateReferralPartnerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(["company", "influencer"])
  type!: ReferralPartnerType;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "code may only contain letters, numbers, - and _",
  })
  code!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Acting admin's email, recorded as the creator. */
  @IsOptional()
  @IsEmail()
  created_by?: string;
}
