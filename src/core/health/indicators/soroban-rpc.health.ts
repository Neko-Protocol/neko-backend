import { Injectable } from "@nestjs/common";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { RpcPoolService } from "../../rpc/pool/rpc-pool.service";

@Injectable()
export class SorobanRpcHealthIndicator extends HealthIndicator {
  constructor(private readonly pool: RpcPoolService) {
    super();
  }

  /**
   * Reports the whole pool rather than a single ping. Readiness only fails when
   * every endpoint is unusable — a degraded or downed endpoint is expected and
   * is exactly what the failover exists to absorb.
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const endpoints = this.pool.snapshot();
    const usable = this.pool.hasUsableEndpoint();

    const result = this.getStatus(key, usable, {
      endpoints,
      usableCount: endpoints.filter((e) => e.state !== "down").length,
      totalCount: endpoints.length,
    });

    if (!usable) {
      throw new HealthCheckError("No usable Soroban RPC endpoint", result);
    }
    return result;
  }
}
