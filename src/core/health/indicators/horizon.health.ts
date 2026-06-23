import { Injectable } from "@nestjs/common";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { StellarRpcService } from "../../stellar/stellar-rpc.service";

@Injectable()
export class HorizonHealthIndicator extends HealthIndicator {
  constructor(private readonly stellar: StellarRpcService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Horizon root returns network metadata; cheap and unauthenticated.
      const root = await this.stellar.horizon.root();
      return this.getStatus(key, true, {
        coreVersion: root.core_version,
        horizonVersion: root.horizon_version,
      });
    } catch (err) {
      const result = this.getStatus(key, false, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HealthCheckError("Horizon unreachable", result);
    }
  }
}
