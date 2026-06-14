import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createDefindexServerSdk,
  defindexNetworkFromString,
  getAssetsConfig,
  getCurrentNetworkId,
  parseDefindexVaultIds,
  type StellarPriceService,
} from "@neko/keeper";
import { STELLAR_PRICE_SERVICE } from "../asset-prices/asset-prices.tokens";

/** Raw DeFindex `getVaultInfo` payload — passed through to the client untouched. */
export type DefindexVaultInfo = Record<string, unknown>;

export interface DefindexVaultEntry {
  contractId: string;
  info: DefindexVaultInfo;
}

export interface DefindexVaultsResult {
  vaults: DefindexVaultEntry[];
  /** USD price per underlying asset contract address. */
  prices: Record<string, number>;
  fetchErrors?: { contractId: string; message: string }[];
  error?: string;
  hint?: string;
}

const SERVER_CACHE_TTL_MS = 30_000;
// DeFindex API rate-limits aggressive parallel calls. Keep concurrency low and
// batches well-spaced so we don't poison the response with partial failures.
const VAULT_FETCH_CONCURRENCY = 2;
const BATCH_GAP_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatVaultFetchError(reason: unknown): string {
  if (reason && typeof reason === "object") {
    const o = reason as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    try {
      return JSON.stringify(o);
    } catch {
      return "Unknown error";
    }
  }
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function isRateLimitError(err: unknown): boolean {
  // The DeFindex SDK rejects with the raw API response body
  // (e.g. { message: "Rate limit exceeded", statusCode: 429 }), not an Error
  // instance, so extract message + statusCode defensively.
  let msg = "";
  let statusCode: number | undefined;
  if (err instanceof Error) {
    msg = err.message;
  } else if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") msg = o.message;
    else if (typeof o.error === "string") msg = o.error;
    if (typeof o.statusCode === "number") statusCode = o.statusCode;
    if (typeof o.status === "number" && statusCode === undefined) {
      statusCode = o.status;
    }
  } else {
    msg = String(err ?? "");
  }
  const lower = msg.toLowerCase();
  return (
    statusCode === 429 ||
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many")
  );
}

@Injectable()
export class DefindexService {
  private readonly logger = new Logger(DefindexService.name);
  private readonly stellarNetwork: string;
  private cache: { data: DefindexVaultsResult; ts: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(STELLAR_PRICE_SERVICE)
    private readonly priceService: StellarPriceService
  ) {
    this.stellarNetwork =
      this.config.get<string>("STELLAR_NETWORK") ?? "mainnet";
  }

  // Fetches a single vault with up to `maxRetries` retries on rate-limit errors.
  private async fetchVaultInfo(
    sdk: ReturnType<typeof createDefindexServerSdk>,
    contractId: string,
    network: NonNullable<ReturnType<typeof defindexNetworkFromString>>,
    maxRetries = 5
  ): Promise<{ contractId: string; info: DefindexVaultInfo }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const info = (await sdk.getVaultInfo(
          contractId,
          network
        )) as unknown as DefindexVaultInfo;
        return { contractId, info };
      } catch (err) {
        if (isRateLimitError(err) && attempt < maxRetries) {
          // Exponential backoff with jitter: ~800ms, 1.6s, 3.2s, 6.4s, 12.8s.
          const base = 800 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * 200);
          await delay(base + jitter);
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max retries exceeded");
  }

  async getVaults(): Promise<DefindexVaultsResult> {
    const network = defindexNetworkFromString(this.stellarNetwork);
    if (!network) {
      return { vaults: [], prices: {}, error: "unsupported_network" };
    }

    const ids = parseDefindexVaultIds();
    if (ids.length === 0) {
      return {
        vaults: [],
        prices: {},
        error: "no_vault_ids",
        hint: "No DeFindex vault IDs configured in @neko/keeper for this network.",
      };
    }

    const apiKey = this.config.get<string>("DEFINDEX_API_KEY")?.trim();
    if (!apiKey) {
      return {
        vaults: [],
        prices: {},
        error: "missing_defindex_api_key",
        hint: "Set DEFINDEX_API_KEY on the backend. The DeFindex HTTP API returns 403 without it.",
      };
    }

    if (this.cache && Date.now() - this.cache.ts < SERVER_CACHE_TTL_MS) {
      return this.cache.data;
    }

    const sdk = createDefindexServerSdk(apiKey);
    const vaults: DefindexVaultEntry[] = [];
    const fetchErrors: { contractId: string; message: string }[] = [];

    const networkId = getCurrentNetworkId(this.stellarNetwork);
    const assetsConfig = Object.values(getAssetsConfig(networkId));

    const pricePromise = Promise.allSettled(
      assetsConfig.map((a) =>
        this.priceService
          .getPriceWithSource(a.code, a.contract)
          .then(({ price }) => ({ contract: a.contract, price }))
      )
    );

    const batchCount = Math.ceil(ids.length / VAULT_FETCH_CONCURRENCY);
    const batchPromises = Array.from({ length: batchCount }, async (_, bi) => {
      if (bi > 0) await delay(bi * BATCH_GAP_MS);
      const batch = ids.slice(
        bi * VAULT_FETCH_CONCURRENCY,
        (bi + 1) * VAULT_FETCH_CONCURRENCY
      );
      return Promise.allSettled(
        batch.map((contractId) => this.fetchVaultInfo(sdk, contractId, network))
      );
    });

    const [priceResults, ...batchResults] = await Promise.all([
      pricePromise,
      ...batchPromises,
    ]);

    const prices: Record<string, number> = {};
    for (const r of priceResults) {
      if (r.status === "fulfilled" && r.value.price > 0) {
        prices[r.value.contract] = r.value.price;
      }
    }

    for (let bi = 0; bi < batchResults.length; bi++) {
      const batchSettled = batchResults[bi] as PromiseSettledResult<{
        contractId: string;
        info: DefindexVaultInfo;
      }>[];
      const batchIds = ids.slice(
        bi * VAULT_FETCH_CONCURRENCY,
        (bi + 1) * VAULT_FETCH_CONCURRENCY
      );
      batchSettled.forEach((result, j) => {
        const contractId = batchIds[j]!;
        if (result.status === "fulfilled") {
          vaults.push({ contractId, info: result.value.info });
        } else {
          fetchErrors.push({
            contractId,
            message: formatVaultFetchError(result.reason),
          });
        }
      });
    }

    const data: DefindexVaultsResult = {
      vaults,
      prices,
      ...(fetchErrors.length > 0 ? { fetchErrors } : {}),
    };

    // Only cache fully-successful responses. A partial failure (typically a
    // DeFindex rate limit on one vault) would otherwise pin a broken response
    // for SERVER_CACHE_TTL_MS and hide vaults from the UI until it expires.
    if (fetchErrors.length === 0) {
      this.cache = { data, ts: Date.now() };
    }

    return data;
  }
}
