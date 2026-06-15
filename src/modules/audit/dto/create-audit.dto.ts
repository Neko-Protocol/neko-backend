import { IsIn, IsNumber, IsOptional, IsString } from "class-validator";

export const AUDIT_ACTION_TYPES = [
  "lend_deposit",
  "lend_withdraw",
  "borrow_deposit",
  "borrow_withdraw",
  "swap",
  "on_ramp",
  "off_ramp",
  "vaults_deposit",
  "vaults_withdraw",
  "vaults_claim_earnings",
  "pool_repay",
  "pool_claim_rewards",
  "activation_payout",
] as const;

export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

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
