import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const DECISIONS = [
  "in_review",
  "approved",
  "rejected",
  "changes_requested",
] as const;

export type ApplicationDecision = (typeof DECISIONS)[number];

export class DecideApplicationDto {
  @ApiProperty({ enum: DECISIONS })
  @IsIn(DECISIONS)
  decision!: ApplicationDecision;

  @ApiPropertyOptional({
    description:
      "Required when decision is rejected or changes_requested (enforced in service).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
