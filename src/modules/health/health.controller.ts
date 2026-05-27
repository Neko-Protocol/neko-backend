import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { SorobanRpcHealthIndicator } from "./indicators/soroban-rpc.health";
import { HorizonHealthIndicator } from "./indicators/horizon.health";

@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly soroban: SorobanRpcHealthIndicator,
    private readonly horizon: HorizonHealthIndicator
  ) {}

  // Cheap process-alive probe. No dependencies — safe for k8s livenessProbe.
  @Get("liveness")
  liveness() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  // Deep readiness probe. Returns 503 if any dependency is down so the load
  // balancer can rotate the instance out.
  @Get("readiness")
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.soroban.isHealthy("soroban_rpc"),
      () => this.horizon.isHealthy("horizon"),
    ]);
  }

  // Back-compat alias — existing probes hit /health.
  @Get()
  legacy() {
    return this.liveness();
  }
}
