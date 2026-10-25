import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import type { VerificationKind } from "../launchpad.types";

export class MockVerificationDto {
  @ApiProperty({ enum: ["kyc", "kyb"] })
  @IsIn(["kyc", "kyb"])
  kind!: VerificationKind;

  @ApiProperty({
    description: "Person (kyc) or business (kyb) name recorded as verified.",
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}
