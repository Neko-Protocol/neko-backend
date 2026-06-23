import { ApiProperty } from "@nestjs/swagger";

export class RecordRatesResponseDto {
  @ApiProperty({ example: 12 })
  inserted!: number;
}
