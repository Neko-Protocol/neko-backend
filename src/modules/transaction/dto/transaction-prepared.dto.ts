import { ApiProperty } from "@nestjs/swagger";

export class TransactionPreparedDto {
  @ApiProperty({ enum: [true] as const })
  ok!: true;

  @ApiProperty({
    description:
      "Hash of the validated unsigned transaction. Must match the hash of the signed XDR submitted afterwards.",
  })
  hash!: string;
}
