import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { AUDIT_ACTION_TYPES, type AuditActionType } from "@neko/api-contracts";

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({ enum: AUDIT_ACTION_TYPES })
  @IsOptional()
  @IsIn(AUDIT_ACTION_TYPES)
  actionType?: AuditActionType;

  @ApiPropertyOptional({ description: "Filter by exact wallet address." })
  @IsOptional()
  @IsString()
  wallet?: string;

  @ApiPropertyOptional({ description: "ISO date, inclusive lower bound." })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: "ISO date, inclusive upper bound." })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: "25" })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ default: "0" })
  @IsOptional()
  @IsString()
  offset?: string;
}
