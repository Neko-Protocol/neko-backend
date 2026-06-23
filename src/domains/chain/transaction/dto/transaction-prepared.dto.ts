import { ApiProperty } from "@nestjs/swagger";
import type { PrepareTransactionResponse } from "@neko/api-contracts";

export class TransactionPreparedDto implements PrepareTransactionResponse {
  @ApiProperty({ enum: [true] as const })
  ok!: true;

  @ApiProperty({
    description:
      "Hash of the validated unsigned transaction. Must match the hash of the signed XDR submitted afterwards.",
  })
  hash!: string;
}
