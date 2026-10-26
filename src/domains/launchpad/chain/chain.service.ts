import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Asset, Horizon, Keypair, rpc } from "@stellar/stellar-sdk";
import { LaunchpadErrorCode } from "../launchpad.types";
import { SorobanClient } from "./soroban";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
/** Circle's USDC on testnet; Circle's faucet hands it out, not Neko. */
const CIRCLE_TESTNET_USDC =
  "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * Everything the Launchpad needs to act on testnet. Only keys and roots come
 * from env; the rest is read off the ledger once and cached.
 */
export interface Platform {
  soroban: SorobanClient;
  horizon: Horizon.Server;
  passphrase: string;
  manager: Keypair;
  /** Only needed to accept each token's admin role; the launch works without it. */
  admin: Keypair | null;
  /**
   * Only when Neko issues the vault asset itself; turns on the faucet. Null
   * for Circle's USDC.
   */
  usdcIssuer: Keypair | null;
  /** 32-byte seed that signs investor KYC/AML claims. */
  claimSigningKey: Buffer;
  identityWasmHash: string;
  factory: string;
  milestoneTracker: string;
  /** `get_templates().platform_admin`; also every vault's fee recipient. */
  platformAdmin: string;
  identityRegistry: string;
  identityVerifier: string;
  claimIssuer: string;
  usdcAsset: Asset;
  usdc: string;
  exitFeeBps: number;
  maxExitFeeBps: number;
  /** Public base URL of this API, for metadata and claim URIs. */
  publicApiUrl: string;
}

interface Templates {
  platform_admin: string;
  platform_manager: string;
  identity_registry: string;
  identity_verifier: string;
}

@Injectable()
export class LaunchpadChainService {
  private readonly logger = new Logger(LaunchpadChainService.name);
  private loading: Promise<Platform> | null = null;

  constructor(private readonly config: ConfigService) {}

  private env(key: string): string {
    return this.config.get<string>(key)?.trim() ?? "";
  }

  /** Required env variables that are not set. */
  missingEnv(): string[] {
    return [
      "NEKO_MANAGER_SECRET",
      "NEKO_CLAIM_SIGNING_KEY",
      "NEKO_FACTORY_ID",
      "NEKO_MILESTONE_TRACKER_ID",
      "NEKO_IDENTITY_WASM_HASH",
    ].filter((key) => !this.env(key));
  }

  isConfigured(): boolean {
    return this.missingEnv().length === 0;
  }

  /** The derived platform, or 503 when the chain keys are not set. */
  platform(): Promise<Platform> {
    const missing = this.missingEnv();
    if (missing.length > 0) {
      return Promise.reject(
        new ServiceUnavailableException({
          code: LaunchpadErrorCode.CHAIN_NOT_CONFIGURED,
          message: `Missing ${missing.join(", ")}`,
        })
      );
    }
    this.loading ??= this.load().catch((error) => {
      // Let the next request try again, e.g. after an RPC outage.
      this.loading = null;
      this.logger.error({ event: "launchpad_chain_load_failed", error });
      throw new ServiceUnavailableException({
        code: LaunchpadErrorCode.CHAIN_NOT_CONFIGURED,
        message: String(error instanceof Error ? error.message : error),
      });
    });
    return this.loading;
  }

  private async load(): Promise<Platform> {
    const passphrase =
      this.env("LAUNCHPAD_NETWORK_PASSPHRASE") || TESTNET_PASSPHRASE;
    const server = new rpc.Server(
      this.env("LAUNCHPAD_RPC_URL") || DEFAULT_RPC_URL
    );
    const manager = Keypair.fromSecret(this.env("NEKO_MANAGER_SECRET"));
    const adminSecret = this.env("NEKO_ADMIN_SECRET");
    const factory = this.env("NEKO_FACTORY_ID");
    const soroban = new SorobanClient(server, passphrase, manager.publicKey());

    const templates = await soroban.read<Templates>(factory, "get_templates");
    if (templates.platform_manager !== manager.publicKey()) {
      throw new Error(
        `NEKO_MANAGER_SECRET is ${manager.publicKey()}, but the factory's manager is ${templates.platform_manager}`
      );
    }
    const topics = await soroban.read<string>(
      templates.identity_verifier,
      "claim_topics_and_issuers"
    );
    const [claimIssuer] = await soroban.read<string[]>(
      topics,
      "get_trusted_issuers"
    );
    if (!claimIssuer) throw new Error("No trusted claim issuer on the ledger");

    const claimSigningKey = Buffer.from(
      this.env("NEKO_CLAIM_SIGNING_KEY"),
      "hex"
    );
    if (claimSigningKey.length !== 32) {
      throw new Error("NEKO_CLAIM_SIGNING_KEY must be 64 hex characters");
    }

    // The asset every vault is raised in. Public: code and issuer only. It
    // must match the asset the Launchpad opens trustlines to.
    const [code, issuer] = (
      this.env("NEKO_USDC_ASSET") || CIRCLE_TESTNET_USDC
    ).split(":");
    const usdcAsset = new Asset(code, issuer);
    const usdcContract = usdcAsset.contractId(passphrase);

    // Optional, for a Neko-issued test asset only: an issuer key that doesn't
    // issue this asset would make the faucet pay something else.
    const issuerSecret = this.env("NEKO_USDC_ISSUER_SECRET");
    const usdcIssuer = issuerSecret ? Keypair.fromSecret(issuerSecret) : null;
    if (usdcIssuer && usdcIssuer.publicKey() !== issuer) {
      throw new Error(
        `NEKO_USDC_ISSUER_SECRET is ${usdcIssuer.publicKey()}, but the vault asset is issued by ${issuer}. Leave it empty for Circle's USDC.`
      );
    }
    const platform: Platform = {
      soroban,
      horizon: new Horizon.Server(
        this.env("LAUNCHPAD_HORIZON_URL") || DEFAULT_HORIZON_URL
      ),
      passphrase,
      manager,
      admin: adminSecret ? Keypair.fromSecret(adminSecret) : null,
      usdcIssuer,
      claimSigningKey,
      identityWasmHash: this.env("NEKO_IDENTITY_WASM_HASH"),
      factory,
      milestoneTracker: this.env("NEKO_MILESTONE_TRACKER_ID"),
      platformAdmin: templates.platform_admin,
      identityRegistry: templates.identity_registry,
      identityVerifier: templates.identity_verifier,
      claimIssuer,
      usdcAsset,
      usdc: usdcContract,
      exitFeeBps: Number(this.env("NEKO_EXIT_FEE_BPS") || 500),
      maxExitFeeBps: Number(this.env("NEKO_MAX_EXIT_FEE_BPS") || 1000),
      publicApiUrl: (
        this.env("LAUNCHPAD_PUBLIC_API_URL") || this.env("LAUNCHPAD_APP_URL")
      ).replace(/\/+$/, ""),
    };
    this.logger.log({
      event: "launchpad_chain_ready",
      factory,
      manager: manager.publicKey(),
      usdc: platform.usdc,
      claimIssuer,
    });
    return platform;
  }

  /** Whether `address` exists and trusts the test USDC, so it can receive it. */
  async hasUsdcTrustline(address: string): Promise<boolean> {
    const { horizon, usdcAsset } = await this.platform();
    try {
      const account = await horizon.loadAccount(address);
      return account.balances.some(
        (b) =>
          "asset_code" in b &&
          b.asset_code === usdcAsset.getCode() &&
          b.asset_issuer === usdcAsset.getIssuer()
      );
    } catch (error) {
      if (
        (error as { response?: { status?: number } }).response?.status === 404
      )
        return false;
      throw error;
    }
  }

  /** The addresses a frontend needs, so none of them live in its env. */
  async publicPlatform(): Promise<PublicPlatform> {
    const p = await this.platform();
    return {
      network_passphrase: p.passphrase,
      rpc_url: this.env("LAUNCHPAD_RPC_URL") || DEFAULT_RPC_URL,
      horizon_url: this.env("LAUNCHPAD_HORIZON_URL") || DEFAULT_HORIZON_URL,
      usdc: p.usdc,
      usdc_code: p.usdcAsset.getCode(),
      usdc_issuer: p.usdcAsset.getIssuer(),
      faucet: p.usdcIssuer !== null,
      milestone_tracker: p.milestoneTracker,
      identity_registry: p.identityRegistry,
      factory: p.factory,
    };
  }
}

export interface PublicPlatform {
  network_passphrase: string;
  rpc_url: string;
  horizon_url: string;
  usdc: string;
  usdc_code: string;
  usdc_issuer: string;
  /** Whether POST /launchpad/faucet/usdc works; false for Circle's USDC. */
  faucet: boolean;
  milestone_tracker: string;
  identity_registry: string;
  factory: string;
}
