import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import type { VerificationKind } from "../launchpad.types";

export class CreateVerificationDto {
  @ApiProperty({
    enum: ["kyc", "kyb"],
    description: "kyc for an individual, kyb for a business.",
  })
  @IsIn(["kyc", "kyb"])
  kind!: VerificationKind;
}
