import { ApiProperty } from "@nestjs/swagger";
import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

export class PrepareTransactionDto {
  @ApiProperty({
    description: "Unsigned Soroban transaction envelope, base64-encoded XDR.",
    maxLength: 65536,
  })
  @IsString()
  @IsBase64()
  @MinLength(1)
  @MaxLength(65536)
  unsignedXdr!: string;
}
