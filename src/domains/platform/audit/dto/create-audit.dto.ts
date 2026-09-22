import { IsIn, IsNumber, IsOptional, IsString } from "class-validator";
import { AUDIT_ACTION_TYPES, type AuditActionType } from "@neko-protocol/api-contracts";

export { AUDIT_ACTION_TYPES, type AuditActionType };

export class CreateAuditDto {
  @IsString()
  wallet_address!: string;

  @IsIn(AUDIT_ACTION_TYPES)
  action_type!: AuditActionType;

  @IsOptional()
  @IsString()
  asset_in?: string;

  @IsOptional()
  @IsString()
  asset_out?: string;

  @IsOptional()
  @IsNumber()
  amount_in?: number;

  @IsOptional()
  @IsNumber()
  token_amount_in?: number;

  @IsOptional()
  @IsNumber()
  amount_out?: number;

  @IsOptional()
  @IsString()
  pool_id?: string;

  @IsOptional()
  @IsString()
  tx_hash?: string;

  @IsOptional()
  @IsNumber()
  platform_fee_bps?: number;

  @IsOptional()
  @IsString()
  platform_fee_amount?: string;
}
