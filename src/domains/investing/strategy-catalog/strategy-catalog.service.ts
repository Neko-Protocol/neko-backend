import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getAssetsConfig, getCurrentNetworkId } from "@neko/keeper";
import type { PoolInfo, PoolType } from "@neko/orchestrator";
import { SupabaseService } from "@core/supabase/supabase.service";
import { OrchestratorService } from "@core/orchestrator/orchestrator.service";
import { DefindexService } from "../defindex/defindex.service";

export interface RefreshCatalogResult {
  upserted: number;
}

type DestinationKind = "pool" | "vault" | "yield-token";

interface CatalogDestination {
  kind: DestinationKind;
  id: string;
  name: string;
  protocol: string;
  apy: number | null;
  acceptedTokenCodes: string[];
}

const POOL_PROTOCOL_LABEL: Record<PoolType, string> = {
  blend: "Blend",
  neko: "Neko",
  soroswap: "Soroswap",
  aqua: "Aqua",
  custom: "Pool",
};

const ETHERFUSE_BOND_SYMBOLS = ["CETES", "USTRY", "TESOURO"] as const;

@Injectable()
export class StrategyCatalogService {
  private readonly logger = new Logger(StrategyCatalogService.name);
  private readonly networkId: ReturnType<typeof getCurrentNetworkId>;

  constructor(
    config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly orchestratorService: OrchestratorService,
    private readonly defindex: DefindexService
  ) {
    this.networkId = getCurrentNetworkId(
      config.get<string>("STELLAR_NETWORK") ?? "mainnet"
    );
  }

  private async buildDestinations(): Promise<CatalogDestination[]> {
    const destinations: CatalogDestination[] = [];

    try {
      const pools: PoolInfo[] =
        await this.orchestratorService.orchestrator.getAllPools();
      for (const pool of pools) {
        destinations.push({
          kind: "pool",
          id: pool.id,
          name: pool.name,
          apy: typeof pool.apy === "number" ? pool.apy : null,
          acceptedTokenCodes: pool.tokens.map((t) => t.code),
          protocol: POOL_PROTOCOL_LABEL[pool.type] ?? "Pool",
        });
      }
    } catch (err) {
      this.logger.error(`[strategy-catalog] pools failed: ${err}`);
    }

    try {
      const { vaults } = await this.defindex.getVaults();
      for (const { contractId, info } of vaults) {
        const name = typeof info.name === "string" ? info.name : contractId;
        const assets = Array.isArray(info.assets)
          ? (info.assets as Array<{ symbol?: unknown }>)
          : [];
        const symbol =
          typeof assets[0]?.symbol === "string"
            ? (assets[0].symbol as string)
            : typeof info.symbol === "string"
              ? (info.symbol as string)
              : name;
        destinations.push({
          kind: "vault",
          id: contractId,
          name,
          apy: null,
          acceptedTokenCodes: [symbol],
          // DeFindex vaults are mapped to the "lending" category in the UI.
          protocol: "Lending",
        });
      }
    } catch (err) {
      this.logger.error(`[strategy-catalog] vaults failed: ${err}`);
    }

    const assets = getAssetsConfig(this.networkId);
    for (const symbol of ETHERFUSE_BOND_SYMBOLS) {
      const cfg = assets[symbol];
      if (!cfg) continue;
      destinations.push({
        kind: "yield-token",
        id: cfg.contract,
        name: cfg.name,
        apy: null,
        acceptedTokenCodes: [symbol],
        protocol: "Sovereign Bond",
      });
    }

    return destinations;
  }

  async refresh(): Promise<RefreshCatalogResult> {
    const build = await this.buildDestinations();
    if (build.length === 0) return { upserted: 0 };

    const syncStartedAt = new Date().toISOString();
    const rows = build.map((d) => ({
      kind: d.kind,
      id: d.id,
      name: d.name,
      protocol: d.protocol,
      apy: d.apy,
      accepted_token_codes: d.acceptedTokenCodes,
      updated_at: syncStartedAt,
    }));

    const { error } = await this.supabase.client
      .from("destination_catalog")
      .upsert(rows, { onConflict: "kind,id" });
    if (error) throw new Error(error.message);

    // Prune entries that were not part of this sync (per kind touched).
    const kindsInBuild = [...new Set(build.map((d) => d.kind))];
    const { error: deleteError } = await this.supabase.client
      .from("destination_catalog")
      .delete()
      .in("kind", kindsInBuild)
      .lt("updated_at", syncStartedAt);
    if (deleteError) throw new Error(deleteError.message);

    this.logger.log(`[strategy-catalog] upserted ${build.length} destinations`);
    return { upserted: build.length };
  }
}
