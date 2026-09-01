import { IsBoolean } from "class-validator";

export class UpdateReferralPartnerDto {
  @IsBoolean()
  is_active!: boolean;
}
