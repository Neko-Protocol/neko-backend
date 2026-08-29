import { Injectable } from "@nestjs/common";
import { Registry } from "prom-client";

/**
 * Owns the single Prometheus registry the application exposes.
 *
 * Collectors are defined by whichever module measures them — the RPC metrics
 * live with the RPC module — and registered here. That keeps the scrape
 * endpoint free of any knowledge about what is being measured, so a new
 * domain can publish metrics without touching it.
 *
 * A private registry rather than prom-client's global default keeps the
 * exposition to series we chose deliberately, which keeps cardinality
 * predictable.
 */
@Injectable()
export class MetricsRegistryService {
  readonly registry = new Registry();

  constructor() {
    this.registry.setDefaultLabels({ service: "neko-backend" });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
