import { ApiProperty } from "@nestjs/swagger";
import type {
  EtherfuseBondSymbol,
  EtherfuseYieldEntry,
} from "@neko-protocol/api-contracts";

export class BondYieldEntryDto implements EtherfuseYieldEntry {
  @ApiProperty({ enum: ["CETES", "USTRY", "TESOURO"] })
  symbol!: EtherfuseBondSymbol;

  @ApiProperty({ example: 9.5 })
  apy!: number;

  @ApiProperty({ example: "MXN" })
  currency!: string;

  @ApiProperty({ example: "2026-05-28T12:00:00.000Z" })
  lastUpdated!: string;
}
