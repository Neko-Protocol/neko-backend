import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PoolEndpoint, RpcPoolService } from "./rpc-pool.service";

export const HEALTH_INTERVAL_MS = 20_000;
/** A health probe that takes longer than this counts as a failure. */
export const HEALTH_TIMEOUT_MS = 5_000;

@Injectable()
export class RpcHealthScheduler {
  private readonly logger = new Logger(RpcHealthScheduler.name);
  private running = false;

  constructor(private readonly pool: RpcPoolService) {}

  @Interval("rpc-pool-health", HEALTH_INTERVAL_MS)
  async handleInterval(): Promise<void> {
    await this.checkAll();
  }

  /**
   * Probes every endpoint in parallel and hands the results to the pool, which
   * owns the up/degraded/down decision. Never throws — a failing probe is data,
   * not an error.
   */
  async checkAll(): Promise<void> {
    // Probes are cheap but not free; skip if the previous sweep is still going.
    if (this.running) return;
    this.running = true;

    try {
      const results = await Promise.all(
        this.pool.all().map((endpoint) => this.probe(endpoint))
      );
      this.pool.applyHealthResults(results);
    } catch (err) {
      this.logger.error(
        `RPC health sweep failed unexpectedly: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      this.running = false;
    }
  }

  private async probe(endpoint: PoolEndpoint): Promise<{
    endpoint: PoolEndpoint;
    healthy: boolean;
    latestLedger: number | null;
    error?: unknown;
  }> {
    try {
      const health = await withTimeout(
        endpoint.server.getHealth(),
        HEALTH_TIMEOUT_MS
      );

      if (health.status !== "healthy") {
        return {
          endpoint,
          healthy: false,
          latestLedger: null,
          error: `status=${health.status}`,
        };
      }

      const latest = await withTimeout(
        endpoint.server.getLatestLedger(),
        HEALTH_TIMEOUT_MS
      );

      return {
        endpoint,
        healthy: true,
        latestLedger: latest.sequence,
      };
    } catch (err) {
      return { endpoint, healthy: false, latestLedger: null, error: err };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`health probe timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}
