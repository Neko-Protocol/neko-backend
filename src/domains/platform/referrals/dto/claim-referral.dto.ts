import { IsString, MaxLength, MinLength } from "class-validator";

export class ClaimReferralDto {
  @IsString()
  @MinLength(1)
  wallet_address!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;
}
