import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Asset,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  NotFoundError,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { StellarRpcService } from "./stellar-rpc.service";

const ACTIVATION_BASE_FEE = "1000";
export const ACTIVATION_TIMEOUT_S = 60;

const RESOURCE_FEE_TOLERANCE = 1.5;
const RESOURCE_FEE_SLACK_STROOPS = 100_000;

export interface AccountState {
  exists: boolean;
  trustlines: Set<string>;
  sponsor: string | null;
}

export function declaredResourceFee(tx: Transaction): number {
  const envelope = tx.toEnvelope();
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) return 0;
  const data = envelope.v1().tx().ext().value();
  return data ? Number(data.resourceFee().toString()) : 0;
}

export interface ActivationPlan {
  user: string;
  createAccount: boolean;
  trustlines: Asset[];
}

export function assetId(asset: Asset): string {
  return asset.isNative()
    ? "native"
    : `${asset.getCode()}:${asset.getIssuer()}`;
}

/**
 * The sponsor account pays the base reserves of new wallets (CAP-33
 * sponsorship, so the user holds 0 XLM) and the network fees of their
 * transactions (fee-bump). The secret never leaves this service.
 */
@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);
  private readonly keypair?: Keypair;

  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarRpcService
  ) {
    const secret = this.config.get<string>("SPONSOR_SECRET_KEY")?.trim();
    if (secret) this.keypair = Keypair.fromSecret(secret);
  }

  isConfigured(): boolean {
    return Boolean(this.keypair);
  }

  get address(): string {
    return this.requireKeypair().publicKey();
  }

  defaultTrustlines(): Asset[] {
    const raw = this.config.get<string>("SPONSOR_TRUSTLINES") ?? "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const [code, issuer] = entry.split(":");
        return new Asset(code, issuer);
      });
  }

  private requireKeypair(): Keypair {
    if (!this.keypair) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SPONSOR_UNAVAILABLE,
      });
    }
    return this.keypair;
  }

  async getAccountState(address: string): Promise<AccountState> {
    try {
      const account = await this.stellar.horizon.loadAccount(address);
      const trustlines = new Set<string>();
      for (const b of account.balances) {
        if (
          (b.asset_type === "credit_alphanum4" ||
            b.asset_type === "credit_alphanum12") &&
          "asset_code" in b
        ) {
          trustlines.add(`${b.asset_code}:${b.asset_issuer}`);
        }
      }
      const sponsor = (account as { sponsor?: string }).sponsor ?? null;
      return { exists: true, trustlines, sponsor };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return { exists: false, trustlines: new Set(), sponsor: null };
      }
      throw err;
    }
  }

  async assertFunded(): Promise<void> {
    const keypair = this.requireKeypair();
    const account = await this.stellar.horizon.loadAccount(keypair.publicKey());
    const native = account.balances.find((b) => b.asset_type === "native");
    const balance = Number(native?.balance ?? 0);
    const min = Number(this.config.get("SPONSOR_MIN_BALANCE_XLM") ?? 5);
    const low = Number(this.config.get("SPONSOR_LOW_BALANCE_XLM") ?? 50);

    if (balance < low) {
      this.logger.warn({
        event: "sponsor_balance_low",
        sponsor: keypair.publicKey(),
        balance,
        threshold: low,
      });
    }
    if (balance < min) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SPONSOR_UNAVAILABLE,
      });
    }
  }

  /**
   * Builds and signs (as sponsor) the activation transaction:
   * begin sponsoring, create the account with 0 XLM, open trustlines, end
   * sponsoring. The user must add their signature for the ops they source.
   */
  async buildActivation(plan: ActivationPlan): Promise<Transaction> {
    const keypair = this.requireKeypair();
    const sponsor = keypair.publicKey();
    const source = await this.stellar.rpc.getAccount(sponsor);

    const builder = new TransactionBuilder(source, {
      fee: ACTIVATION_BASE_FEE,
      networkPassphrase: this.stellar.getNetworkPassphrase(),
    })
      .setTimeout(ACTIVATION_TIMEOUT_S)
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: plan.user,
          source: sponsor,
        })
      );

    if (plan.createAccount) {
      builder.addOperation(
        Operation.createAccount({
          destination: plan.user,
          startingBalance: "0",
          source: sponsor,
        })
      );
    }
    for (const asset of plan.trustlines) {
      builder.addOperation(Operation.changeTrust({ asset, source: plan.user }));
    }
    builder.addOperation(
      Operation.endSponsoringFutureReserves({ source: plan.user })
    );

    const tx = builder.build();
    tx.sign(keypair);
    return tx;
  }

  /**
   * Rejects a transaction whose declared resource fee is well above what the
   * simulation says it needs, before the user signs it.
   */
  assertResourceFeeMatchesSimulation(
    inner: Transaction,
    simulatedMinResourceFee: number
  ): void {
    const declared = declaredResourceFee(inner);
    const allowed =
      simulatedMinResourceFee * RESOURCE_FEE_TOLERANCE +
      RESOURCE_FEE_SLACK_STROOPS;
    if (declared > allowed) {
      this.logger.warn({
        event: "sponsor_resource_fee_inflated",
        source: inner.source,
        declared,
        simulated: simulatedMinResourceFee,
      });
      throw new UnprocessableEntityException({
        code: ErrorCode.SPONSOR_FEE_TOO_HIGH,
      });
    }
  }

  /**
   * The fee-bump base fee for an inner transaction: its own inclusion rate,
   * never below the network minimum. Throws when the total would exceed
   * SPONSOR_MAX_FEE_STROOPS.
   */
  quoteFeeBump(inner: Transaction): { baseFee: number; total: number } {
    const opCount = inner.operations.length;
    const resourceFee = declaredResourceFee(inner);
    const innerRate = Math.ceil((Number(inner.fee) - resourceFee) / opCount);
    const baseFee = Math.max(Number(BASE_FEE), innerRate);
    const total = baseFee * (opCount + 1) + resourceFee;

    const max = Number(this.config.get("SPONSOR_MAX_FEE_STROOPS") ?? 5_000_000);
    if (total > max) {
      this.logger.warn({
        event: "sponsor_fee_too_high",
        source: inner.source,
        total,
        max,
      });
      throw new UnprocessableEntityException({
        code: ErrorCode.SPONSOR_FEE_TOO_HIGH,
      });
    }
    return { baseFee, total };
  }

  /** Wraps a user-signed transaction in a fee-bump paid by the sponsor. */
  feeBump(inner: Transaction): FeeBumpTransaction {
    const keypair = this.requireKeypair();
    const { baseFee } = this.quoteFeeBump(inner);
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      keypair,
      String(baseFee),
      inner,
      this.stellar.getNetworkPassphrase()
    );
    bump.sign(keypair);
    return bump;
  }
}
