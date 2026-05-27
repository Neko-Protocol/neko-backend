import { Matches } from "class-validator";

export class TransactionHashParamDto {
  @Matches(/^[a-f0-9]{64}$/, {
    message: "hash must be a 64-character lowercase hex string",
  })
  hash!: string;
}
