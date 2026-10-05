import { ApiProperty } from "@nestjs/swagger";
import type { ActivationSubmitRequest } from "@neko-protocol/api-contracts";
import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

export class ActivationSubmitDto implements ActivationSubmitRequest {
  @ApiProperty({
    description:
      "The activation XDR from /me/wallet/activation/prepare, signed by the user.",
    maxLength: 65536,
  })
  @IsString()
  @IsBase64()
  @MinLength(1)
  @MaxLength(65536)
  signedXdr!: string;
}
