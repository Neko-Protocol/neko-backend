import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko/api-contracts";
import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { PoolV2 } from "@blend-capital/blend-sdk";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import {
  createDefindexServerSdk,
  defindexNetworkFromString,
  resolveVaultIdForApi,
} from "@neko/keeper";
import {
  computeBlendEmissionsApy,
  getBlendNetwork,
  getBlndPriceUsd,
  type StellarNetworkId,
} from "@neko/orchestrator";
import type { Network } from "@blend-capital/blend-sdk";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";

function mapNetworkId(raw: string): StellarNetworkId {
  const n = raw.trim().toUpperCase();
  if (n === "MAINNET" || n === "PUBLIC" || n === "PUBNET") return "PUBLIC";
  if (n === "TESTNET") return "TESTNET";
  if (n === "FUTURENET") return "FUTURENET";
  if (n === "LOCAL" || n === "STANDALONE") return "LOCAL";
  return "PUBLIC";
}

// CETES vault - the only vault with custom per-strategy APY getters.
const CETES_VAULT_ID =
  "CCFWKCD52JNSQLN5OS4F7EG6BPDT4IRJV6KODIEIZLWPM35IKHOKT6S2";

// Neko standalone vaults backed by Blend strategies. Each entry is one or more
// { poolId, assetAddress } pairs. When multiple pools are listed the APY is
// averaged (equal weight assumed until on-chain allocations are fetched).
const NEKO_VAULT_BLEND_ASSETS: Record<
  string,
  Array<{ poolId: string; assetAddress: string }>
> = {
  // EURC vault → EURC in the Fixed Pool
  CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ: [
    {
      poolId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
      assetAddress: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV",
    },
  ],
  // USDC vault → USDC in the Fixed Pool (single strategy, 100%)
  CCUZC3HC5TH2VCYZFUG57E6IGKPL45YUN2SI3UEYQUBA7RCYHUIZBSFV: [
    {
      poolId: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD",
      assetAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    },
  ],
};

const NEKO_POOL_CONTRACT =
  "CB4HAFD6ECCOQZXOD6FXUVDM3E773LKR5JHVGA3DBJXIWHZUWX2THEDJ";
const AQUARIUS_POOL =
  "CBJPT2SCZSUJQGBZHHCHLZJX3GVYLOPVUKF53ESH4NFQZMC2UFPDWHRI";
const AQUARIUS_STRATEGY =
  "CCGV5QSAFRT6OGBZNCE72I6BAODXLDMWEUYAOBI5ZBLHOURSEGVGFTTZ";
const NEKO_STRATEGY =
  "CCCEWBCYSIHTGBJ2TUOAFQY63UJ4SWDYTYNAEGXWPB7FP6PRHHGVZJIR";

const SCALAR_7 = 10_000_000;

export interface VaultApyStrategy {
  name: string;
  apy: number | null;
  weight: number;
}

export interface VaultApyResult {
  vaultApy: number | null;
  strategies: VaultApyStrategy[];
  note?: string;
}

type SdkResult = {
  tag?: string;
  value?: unknown;
  unwrap?: () => unknown;
};

function unwrapSdkResult(raw: unknown): unknown {
  const r = raw as SdkResult;
  if (r?.tag === "ok") return r.value;
  if (typeof r?.unwrap === "function") return r.unwrap();
  return raw;
}

@Injectable()
export class VaultApyService {
  private readonly logger = new Logger(VaultApyService.name);
  private readonly stellarNetwork: string;

  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarRpcService
  ) {
    this.stellarNetwork =
      this.config.get<string>("STELLAR_NETWORK") ?? "mainnet";
  }

  private get isMainnet(): boolean {
    const upper = this.stellarNetwork.trim().toUpperCase();
    return upper === "MAINNET" || upper === "PUBLIC" || upper === "PUBNET";
  }

  private blendNetwork(): Network {
    return getBlendNetwork({
      id: mapNetworkId(this.stellarNetwork),
      rpcUrl: this.stellar.getSafeRpcUrl(),
      passphrase: this.stellar.getNetworkPassphrase(),
    });
  }

  // ─── Neko APY ───────────────────────────────────────────────────────────
  private async getNekoApy(managerPublicKey: string): Promise<number | null> {
    try {
      const server = this.stellar.rpc;
      const networkPassphrase = this.stellar.getNetworkPassphrase();
      const account = await server.getAccount(managerPublicKey);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: NEKO_POOL_CONTRACT,
            function: "get_interest_rate",
            args: [nativeToScVal("CETES", { type: "symbol" })],
          })
        )
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) return null;

      const raw = scValToNative(sim.result!.retval);
      const aprRaw: bigint =
        typeof raw === "object" && raw !== null && "ok" in raw
          ? BigInt(raw.ok)
          : typeof raw === "bigint"
            ? raw
            : BigInt(String(raw));

      const apr = Number(aprRaw) / SCALAR_7;
      const apy = Math.pow(1 + apr / 365, 365) - 1;
      return apy * 100;
    } catch {
      return null;
    }
  }

  // ─── Aquarius APY ───────────────────────────────────────────────────────
  private async getAquariusApy(): Promise<number | null> {
    try {
      const base = this.isMainnet
        ? "https://amm-api.aqua.network"
        : "https://amm-api-testnet.aqua.network";

      const res = await fetch(`${base}/pools/?address__in=${AQUARIUS_POOL}`);
      if (!res.ok) return null;

      const data = await res.json();
      const pool = data?.items?.[0];
      if (!pool) return null;

      return parseFloat(pool.total_apy) * 100;
    } catch {
      return null;
    }
  }

  // ─── Vault allocations ──────────────────────────────────────────────────
  private async getAllocations(
    client: DefindexVaultClient
  ): Promise<Record<string, number>> {
    const fundsTx = await client.fetch_total_managed_funds({ simulate: true });
    const funds = unwrapSdkResult(fundsTx.result) as Array<{
      total_amount: { toString(): string };
      strategy_allocations: Array<{
        strategy_address: string;
        amount: { toString(): string };
      }>;
    }>;

    const total = Number(BigInt(funds[0].total_amount.toString()));
    if (total === 0) return {};

    const result: Record<string, number> = {};
    for (const alloc of funds[0].strategy_allocations) {
      const addr: string = alloc.strategy_address;
      const amount = Number(BigInt(alloc.amount.toString()));
      result[addr] = amount / total;
    }
    return result;
  }

  // ─── DefIndex SDK APY ───────────────────────────────────────────────────
  private async getDefindexVaultApy(vaultId: string): Promise<number | null> {
    try {
      const apiKey = this.config.get<string>("DEFINDEX_API_KEY")?.trim() ?? "";
      const sdk = createDefindexServerSdk(apiKey);
      const network = defindexNetworkFromString(this.stellarNetwork);
      if (!network) return null;
      const result = await sdk.getVaultAPY(vaultId, network);
      return typeof result?.apy === "number" ? result.apy : null;
    } catch {
      return null;
    }
  }

  // ─── Blend supply APY (base + BLND emissions) ───────────────────────────
  private async getBlendSupplyApy(
    poolId: string,
    assetAddress: string,
    blndPriceUsd: number
  ): Promise<number | null> {
    try {
      const network = this.blendNetwork();
      const pool = await PoolV2.load(network, poolId);
      const reserve = pool.reserves.get(assetAddress);
      if (!reserve) return null;

      const baseApy = reserve.estSupplyApy * 100;

      const emissionsApy = await computeBlendEmissionsApy(
        reserve,
        pool,
        assetAddress,
        blndPriceUsd
      );

      return emissionsApy !== null ? baseApy + emissionsApy : baseApy;
    } catch {
      return null;
    }
  }

  // ─── Blend vault APY ────────────────────────────────────────────────────
  private async getBlendVaultApy(
    vaultId: string,
    defindexApy: number | null
  ): Promise<VaultApyResult> {
    const blendPools = NEKO_VAULT_BLEND_ASSETS[vaultId];
    if (!blendPools) return { vaultApy: defindexApy, strategies: [] };

    let blndPrice = 0;
    try {
      const firstPool = await PoolV2.load(
        this.blendNetwork(),
        blendPools[0].poolId
      );
      blndPrice = await getBlndPriceUsd(
        firstPool.metadata.backstop,
        this.blendNetwork()
      );
    } catch {
      // BLND price unavailable — emissions skipped
    }

    const poolApys = await Promise.all(
      blendPools.map((p) =>
        this.getBlendSupplyApy(p.poolId, p.assetAddress, blndPrice)
      )
    );
    const validApys = poolApys.filter((a): a is number => a !== null);
    const blendApy =
      validApys.length > 0
        ? validApys.reduce((s, a) => s + a, 0) / validApys.length
        : null;
    const vaultApy = defindexApy ?? blendApy;
    return {
      vaultApy: vaultApy !== null ? parseFloat(vaultApy.toFixed(2)) : null,
      strategies:
        blendApy !== null
          ? [
              {
                name: "Blend",
                apy: parseFloat(blendApy.toFixed(2)),
                weight: 100,
              },
            ]
          : [],
    };
  }

  async getVaultApy(vaultParam: string | null): Promise<VaultApyResult> {
    const vaultId = resolveVaultIdForApi(vaultParam);
    if (!vaultId) {
      return {
        vaultApy: null,
        strategies: [],
        note: "No vault configured for this network.",
      };
    }

    // For all vaults, try the DeFindex SDK APY first.
    const defindexApy = await this.getDefindexVaultApy(vaultId);

    // For the CETES vault only, also compute manual weighted APY from on-chain
    // strategy data as a fallback when the SDK does not return a value.
    if (vaultId === CETES_VAULT_ID) {
      const secretKey = this.config.get<string>("VAULT_MANAGER_SECRET_KEY");
      if (!secretKey) {
        // Mirrors the original 503: cannot simulate on-chain without the key.
        throw new ServiceUnavailableException({
          code: ErrorCode.NOT_CONFIGURED,
        });
      }
      const keypair = Keypair.fromSecret(secretKey);
      const rpcUrl = this.stellar.getSafeRpcUrl();
      const networkPassphrase = this.stellar.getNetworkPassphrase();

      const client = new DefindexVaultClient({
        contractId: vaultId,
        rpcUrl,
        networkPassphrase,
        publicKey: keypair.publicKey(),
        ...(rpcUrl.startsWith("http://") ? { allowHttp: true } : {}),
      });

      const [nekoApy, aquariusApy, allocations] = await Promise.all([
        this.getNekoApy(keypair.publicKey()),
        this.getAquariusApy(),
        this.getAllocations(client),
      ]);

      const strategies = [
        {
          name: "Neko",
          address: NEKO_STRATEGY,
          apy: nekoApy,
          weight: allocations[NEKO_STRATEGY] ?? 0,
        },
        {
          name: "Aquarius",
          address: AQUARIUS_STRATEGY,
          apy: aquariusApy,
          weight: allocations[AQUARIUS_STRATEGY] ?? 0,
        },
      ];

      const knownStrategies = strategies.filter((s) => s.apy !== null);
      const totalKnownWeight = knownStrategies.reduce(
        (sum, s) => sum + s.weight,
        0
      );

      let manualVaultApy: number | null = null;
      if (knownStrategies.length > 0 && totalKnownWeight > 0) {
        manualVaultApy = knownStrategies.reduce((sum, s) => {
          const normalizedWeight = s.weight / totalKnownWeight;
          return sum + s.apy! * normalizedWeight;
        }, 0);
      }

      const vaultApy = defindexApy ?? manualVaultApy;

      return {
        vaultApy: vaultApy !== null ? parseFloat(vaultApy.toFixed(4)) : null,
        strategies: strategies.map((s) => ({
          name: s.name,
          apy: s.apy !== null ? parseFloat(s.apy.toFixed(4)) : null,
          weight: parseFloat((s.weight * 100).toFixed(4)),
        })),
      };
    }

    // Neko Blend-backed vaults: fall back to Blend supply APY when DeFindex has
    // no history yet.
    if (NEKO_VAULT_BLEND_ASSETS[vaultId]) {
      return this.getBlendVaultApy(vaultId, defindexApy);
    }

    // All other vaults: SDK APY only.
    return {
      vaultApy:
        defindexApy !== null ? parseFloat(defindexApy.toFixed(4)) : null,
      strategies: [],
    };
  }
}
