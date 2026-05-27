import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";

export class TransactionHashParamDto {
  @ApiProperty({
    description: "Soroban transaction hash, 64 lowercase hex characters.",
    example: "a".repeat(64),
    pattern: "^[a-f0-9]{64}$",
  })
  @Matches(/^[a-f0-9]{64}$/, {
    message: "hash must be a 64-character lowercase hex string",
  })
  hash!: string;
}
