import { Injectable } from "@nestjs/common";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { StellarRpcService } from "../../stellar/stellar-rpc.service";

@Injectable()
export class SorobanRpcHealthIndicator extends HealthIndicator {
  constructor(private readonly stellar: StellarRpcService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const resp = await this.stellar.rpc.getHealth();
      const isUp = resp.status === "healthy";
      const result = this.getStatus(key, isUp, {
        rpcStatus: resp.status,
        network: this.stellar.getNetwork(),
      });
      if (!isUp)
        throw new HealthCheckError(`Soroban RPC status=${resp.status}`, result);
      return result;
    } catch (err) {
      const result = this.getStatus(key, false, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HealthCheckError("Soroban RPC unreachable", result);
    }
  }
}
