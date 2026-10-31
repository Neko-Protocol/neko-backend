import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import type { VerificationApp, VerificationKind } from "../launchpad.types";

export class CreateVerificationDto {
  @ApiProperty({
    enum: ["kyc", "kyb"],
    description: "kyc for an individual, kyb for a business.",
  })
  @IsIn(["kyc", "kyb"])
  kind!: VerificationKind;

  @ApiProperty({
    enum: ["launchpad", "pro"],
    required: false,
    default: "launchpad",
    description: "Frontend Didit returns to when the session ends.",
  })
  @IsOptional()
  @IsIn(["launchpad", "pro"])
  app?: VerificationApp;
}
