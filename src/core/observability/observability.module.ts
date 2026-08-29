import { Global, Module } from "@nestjs/common";
import { MetricsController } from "./metrics/metrics.controller";
import { MetricsRegistryService } from "./metrics/metrics-registry.service";

/**
 * Cross-cutting observability: the Prometheus registry and its scrape
 * endpoint. Global so any module can register collectors without importing it.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsRegistryService],
  exports: [MetricsRegistryService],
})
export class ObservabilityModule {}
