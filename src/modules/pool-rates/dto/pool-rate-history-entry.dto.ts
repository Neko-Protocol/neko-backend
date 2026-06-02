import { ApiProperty } from "@nestjs/swagger";

export class PoolRateHistoryEntryDto {
  @ApiProperty({ example: 5.2 })
  supply_apy!: number;

  @ApiProperty({ example: 8.1, nullable: true })
  borrow_apy!: number | null;

  @ApiProperty({ example: "2026-06-01T12:00:00.000Z" })
  recorded_at!: string;
}
