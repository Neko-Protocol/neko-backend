import { ApiProperty } from "@nestjs/swagger";
import type { SubmitTransactionRequest } from "@neko-protocol/api-contracts";
import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

export class SubmitTransactionDto implements SubmitTransactionRequest {
  @ApiProperty({
    description: "Signed Soroban transaction envelope, base64-encoded XDR.",
    maxLength: 65536,
  })
  @IsString()
  @IsBase64()
  @MinLength(1)
  @MaxLength(65536)
  signedXdr!: string;
}
