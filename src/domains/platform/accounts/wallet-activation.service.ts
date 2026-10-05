import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ErrorCode,
  type ActivationPrepareResponse,
  type ActivationSubmitResponse,
  type WalletPublic,
} from "@neko-protocol/api-contracts";
import { assertActivationOnly } from "@neko-protocol/wallet-core";
import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { PrivyPrincipal } from "@core/privy/privy.types";
import {
  ACTIVATION_TIMEOUT_S,
  SponsorService,
  assetId,
} from "@core/stellar/sponsor.service";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { PreparedTxCache } from "@domains/chain/transaction/cache/prepared-tx-cache";
import { TransactionService } from "@domains/chain/transaction/transaction.service";
import { AccountsService } from "./accounts.service";
import { ActivationLease } from "./activation-lease";

const LEASE_MS = (ACTIVATION_TIMEOUT_S + 5) * 1_000;
const LEASE_WAIT_MS = 15_000;
const DEFAULT_DAILY_CAP = 100;

type ActivationStatus = "pending" | "activated" | "failed";

@Injectable()
export class WalletActivationService {
  private readonly logger = new Logger(WalletActivationService.name);
  private readonly prepared = new PreparedTxCache({
    ttlMs: ACTIVATION_TIMEOUT_S * 1_000,
  });
  private readonly lease = new ActivationLease(LEASE_MS);

  constructor(
    private readonly accounts: AccountsService,
    private readonly sponsor: SponsorService,
    private readonly stellar: StellarRpcService,
    private readonly transactions: TransactionService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService
  ) {}

  async prepare(principal: PrivyPrincipal): Promise<ActivationPrepareResponse> {
    const wallet = await this.accounts.requirePrimaryWallet(principal);
    if (wallet.activation_status === "activated") {
      throw new ConflictException({ code: ErrorCode.ALREADY_ACTIVATED });
    }
    if (!this.sponsor.isConfigured()) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SPONSOR_UNAVAILABLE,
      });
    }

    const state = await this.sponsor.getAccountState(wallet.address);
    const missing = this.sponsor
      .defaultTrustlines()
      .filter((asset) => !state.trustlines.has(assetId(asset)));

    if (state.exists && missing.length === 0) {
      await this.record(wallet, {
        status: "activated",
        tx_hash: null,
        sponsor_address:
          state.sponsor === this.sponsor.address ? state.sponsor : null,
      });
      throw new ConflictException({ code: ErrorCode.ALREADY_ACTIVATED });
    }

    if (wallet.activation_status === "not_activated") {
      await this.assertUnderDailyCap(wallet);
    }

    if (!(await this.lease.acquire(wallet.address, LEASE_WAIT_MS))) {
      throw new ServiceUnavailableException({ code: ErrorCode.SPONSOR_BUSY });
    }

    try {
      await this.sponsor.assertFunded();
      const tx = await this.sponsor.buildActivation({
        user: wallet.address,
        createAccount: !state.exists,
        trustlines: missing,
      });
      const passphrase = this.stellar.getNetworkPassphrase();
      const xdr = tx.toXDR();

      assertActivationOnly({
        xdr,
        networkPassphrase: passphrase,
        sponsor: this.sponsor.address,
        user: wallet.address,
        allowedTrustlines: missing.map(assetId),
      });

      const hash = tx.hash().toString("hex");
      this.prepared.set(wallet.address, { hash, passphrase });
      await this.record(wallet, {
        status: "pending",
        tx_hash: null,
        sponsor_address: this.sponsor.address,
      });

      this.logger.log({
        event: "activation_prepared",
        walletId: wallet.id,
        hash,
        createAccount: !state.exists,
        trustlines: missing.map(assetId),
      });

      return {
        xdr,
        hash,
        network_passphrase: passphrase,
        sponsor_address: this.sponsor.address,
      };
    } catch (err) {
      this.lease.release(wallet.address);
      throw err;
    }
  }

  async submit(
    principal: PrivyPrincipal,
    signedXdr: string,
    requestTraceId?: string
  ): Promise<ActivationSubmitResponse> {
    const traceId = requestTraceId ?? randomUUID();
    const wallet = await this.accounts.requirePrimaryWallet(principal);
    try {
      return await this.submitHeld(wallet, principal, signedXdr, traceId);
    } finally {
      this.lease.release(wallet.address);
    }
  }

  private async submitHeld(
    wallet: WalletPublic,
    principal: PrivyPrincipal,
    signedXdr: string,
    traceId: string
  ): Promise<ActivationSubmitResponse> {
    const passphrase = this.stellar.getNetworkPassphrase();

    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(signedXdr, passphrase);
    } catch {
      throw new BadRequestException({ code: ErrorCode.INVALID_XDR, traceId });
    }
    const hash = tx.hash().toString("hex");
    const cached = this.prepared.consume(wallet.address);
    if (
      tx instanceof FeeBumpTransaction ||
      !cached ||
      cached.hash !== hash ||
      cached.passphrase !== passphrase
    ) {
      this.logger.warn({
        event: "activation_submit_rejected",
        walletId: wallet.id,
        traceId,
        reason: !cached ? "prepare_expired_or_missing" : "hash_mismatch",
      });
      throw new ForbiddenException({
        code: ErrorCode.ACTIVATION_TX_MISMATCH,
        traceId,
      });
    }

    const sponsor_address = this.sponsor.address;
    let result;
    try {
      result = await this.transactions.sendAndWait(tx, traceId);
    } catch (err) {
      await this.record(wallet, {
        status: "failed",
        tx_hash: hash,
        sponsor_address,
        error: err instanceof Error ? err.message : "send_failed",
      });
      throw err;
    }

    if (result.status === "SUCCESS") {
      await this.record(wallet, {
        status: "activated",
        tx_hash: hash,
        sponsor_address,
      });
    } else if (result.status === "FAILED") {
      await this.record(wallet, {
        status: "failed",
        tx_hash: hash,
        sponsor_address,
        error: result.error?.message ?? result.error?.code ?? "failed",
      });
    } else {
      await this.record(wallet, {
        status: "pending",
        tx_hash: hash,
        sponsor_address,
      });
    }

    this.logger.log({
      event: "activation_submitted",
      walletId: wallet.id,
      traceId,
      hash,
      status: result.status,
    });

    const refreshed = await this.accounts.requirePrimaryWallet(principal);
    return { wallet: refreshed, hash };
  }

  private async assertUnderDailyCap(wallet: WalletPublic): Promise<void> {
    const cap = Number(
      this.config.get("SPONSOR_DAILY_ACTIVATION_CAP") ?? DEFAULT_DAILY_CAP
    );
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { count, error } = await this.supabase.client
      .from("wallet_activations")
      .select("id", { count: "exact", head: true })
      .eq("network", wallet.network)
      .gte("created_at", startOfDay.toISOString());
    if (error) {
      this.logger.error({ event: "activation_count_failed", error });
      throw new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
    }
    if ((count ?? 0) >= cap) {
      this.logger.warn({ event: "activation_daily_cap_reached", cap });
      throw new ServiceUnavailableException({
        code: ErrorCode.ACTIVATION_LIMIT_REACHED,
      });
    }
  }

  private async record(
    wallet: WalletPublic,
    patch: {
      status: ActivationStatus;
      tx_hash: string | null;
      sponsor_address: string | null;
      error?: string;
    }
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from("wallet_activations")
      .upsert(
        {
          wallet_id: wallet.id,
          network: wallet.network,
          sponsor_address: patch.sponsor_address,
          status: patch.status,
          tx_hash: patch.tx_hash,
          error: patch.error ?? null,
        },
        { onConflict: "wallet_id,network" }
      );
    if (error) {
      this.logger.error({ event: "activation_record_failed", error });
      throw new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
    }
  }
}
