import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { rpc } from "@stellar/stellar-sdk";
import {
  loadRpcEndpoints,
  RpcEndpointConfig,
} from "../config/rpc-endpoint.config";

/**
 * up       — healthy and current.
 * degraded — reachable but its ledger lags the pool; usable only as a last
 *            resort, because serving stale ledger state is the exact failure
 *            this gateway exists to remove.
 * down     — circuit breaker open after repeated failures.
 */
export type EndpointState = "up" | "degraded" | "down";

export interface EndpointSnapshot {
  label: string;
  host: string;
  priority: number;
  state: EndpointState;
  latestLedger: number | null;
  ledgerLag: number | null;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface PoolEndpoint {
  readonly config: RpcEndpointConfig;
  readonly server: rpc.Server;
  state: EndpointState;
  consecutiveFailures: number;
  /** Epoch ms the breaker opened; null while closed. */
  breakerOpenedAt: number | null;
  latestLedger: number | null;
  ledgerLag: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
}

/** Consecutive failures before the breaker opens. */
export const FAILURE_THRESHOLD = 3;
/** How long the breaker stays open before allowing a probe. */
export const BREAKER_COOLDOWN_MS = 30_000;
/** Ledgers behind the pool max before an endpoint is considered stale. */
export const MAX_LEDGER_LAG = 5;

@Injectable()
export class RpcPoolService implements OnModuleInit {
  private readonly logger = new Logger(RpcPoolService.name);
  private endpoints: PoolEndpoint[] = [];

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.endpoints = loadRpcEndpoints(this.configService).map((config) => ({
      config,
      server: new rpc.Server(config.url, {
        allowHttp: config.allowHttp,
        headers: Object.keys(config.headers).length
          ? config.headers
          : undefined,
      }),
      state: "up" as EndpointState,
      consecutiveFailures: 0,
      breakerOpenedAt: null,
      latestLedger: null,
      ledgerLag: null,
      lastCheckedAt: null,
      lastError: null,
    }));

    this.logger.log(
      `RPC pool initialized with ${this.endpoints.length} endpoint(s): ${this.endpoints
        .map((e) => `${e.config.label}(p${e.config.priority})`)
        .join(", ")}`
    );
  }

  all(): PoolEndpoint[] {
    return this.endpoints;
  }

  byLabel(label: string): PoolEndpoint | undefined {
    return this.endpoints.find((e) => e.config.label === label);
  }

  /**
   * Candidates in the order the client should try them: healthy endpoints by
   * priority first, then degraded (stale) ones, then any whose breaker has
   * cooled down and deserves a probe.
   *
   * A degraded endpoint is still better than no response at all — but it only
   * ever runs after every healthy endpoint has been exhausted.
   */
  candidates(): PoolEndpoint[] {
    const now = Date.now();
    const up: PoolEndpoint[] = [];
    const degraded: PoolEndpoint[] = [];
    const probes: PoolEndpoint[] = [];

    for (const endpoint of this.endpoints) {
      if (endpoint.state === "down") {
        if (
          endpoint.breakerOpenedAt !== null &&
          now - endpoint.breakerOpenedAt >= BREAKER_COOLDOWN_MS
        ) {
          probes.push(endpoint);
        }
        continue;
      }
      if (endpoint.state === "degraded") {
        degraded.push(endpoint);
        continue;
      }
      up.push(endpoint);
    }

    const byPriority = (a: PoolEndpoint, b: PoolEndpoint) =>
      a.config.priority - b.config.priority;

    return [
      ...up.sort(byPriority),
      ...degraded.sort(byPriority),
      ...probes.sort(byPriority),
    ];
  }

  recordSuccess(endpoint: PoolEndpoint): void {
    const wasDown = endpoint.state === "down";
    endpoint.consecutiveFailures = 0;
    endpoint.breakerOpenedAt = null;
    endpoint.lastError = null;
    // A stale endpoint stays degraded until the health scheduler re-evaluates
    // its ledger — a successful call says nothing about how current it is.
    if (endpoint.state !== "degraded") endpoint.state = "up";
    if (wasDown) {
      this.logger.log(`RPC endpoint recovered: ${endpoint.config.label}`);
    }
  }

  recordFailure(endpoint: PoolEndpoint, error: unknown): void {
    endpoint.consecutiveFailures += 1;
    endpoint.lastError = error instanceof Error ? error.message : String(error);

    if (
      endpoint.consecutiveFailures >= FAILURE_THRESHOLD &&
      endpoint.state !== "down"
    ) {
      endpoint.state = "down";
      endpoint.breakerOpenedAt = Date.now();
      this.logger.warn(
        `RPC circuit breaker opened for ${endpoint.config.label} after ${endpoint.consecutiveFailures} failures: ${endpoint.lastError}`
      );
    }
  }

  /**
   * Applies health-check results. Endpoints more than MAX_LEDGER_LAG behind the
   * furthest-ahead endpoint are marked degraded so they stop serving stale
   * ledger state to users.
   */
  applyHealthResults(
    results: Array<{
      endpoint: PoolEndpoint;
      healthy: boolean;
      latestLedger: number | null;
      error?: unknown;
    }>
  ): void {
    const now = Date.now();

    for (const result of results) {
      result.endpoint.lastCheckedAt = now;
      result.endpoint.latestLedger = result.latestLedger;
      if (result.healthy) {
        this.recordSuccess(result.endpoint);
      } else {
        this.recordFailure(
          result.endpoint,
          result.error ?? "health check failed"
        );
      }
    }

    const ledgers = results
      .filter((r) => r.healthy && typeof r.latestLedger === "number")
      .map((r) => r.latestLedger as number);

    if (ledgers.length === 0) return;
    const maxLedger = Math.max(...ledgers);

    for (const result of results) {
      const endpoint = result.endpoint;
      if (
        endpoint.state === "down" ||
        typeof endpoint.latestLedger !== "number"
      ) {
        endpoint.ledgerLag = null;
        continue;
      }

      const lag = maxLedger - endpoint.latestLedger;
      endpoint.ledgerLag = lag;

      if (lag > MAX_LEDGER_LAG) {
        if (endpoint.state !== "degraded") {
          this.logger.warn(
            `RPC endpoint ${endpoint.config.label} is ${lag} ledgers behind the pool — marking degraded.`
          );
        }
        endpoint.state = "degraded";
      } else if (endpoint.state === "degraded") {
        this.logger.log(
          `RPC endpoint ${endpoint.config.label} caught up (lag ${lag}) — back in rotation.`
        );
        endpoint.state = "up";
      }
    }
  }

  snapshot(): EndpointSnapshot[] {
    return this.endpoints.map((endpoint) => ({
      label: endpoint.config.label,
      host: safeHost(endpoint.config.url),
      priority: endpoint.config.priority,
      state: endpoint.state,
      latestLedger: endpoint.latestLedger,
      ledgerLag: endpoint.ledgerLag,
      consecutiveFailures: endpoint.consecutiveFailures,
      lastCheckedAt: endpoint.lastCheckedAt
        ? new Date(endpoint.lastCheckedAt).toISOString()
        : null,
      lastError: endpoint.lastError,
    }));
  }

  /** True when at least one endpoint can currently serve traffic. */
  hasUsableEndpoint(): boolean {
    return this.candidates().length > 0;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
