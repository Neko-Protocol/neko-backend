import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { RpcMetricsController } from "./rpc-metrics.controller";
import { RpcMetricsService } from "./rpc-metrics.service";

const TOKEN = "a-scrape-token-long-enough-to-pass";

function makeController(token?: string) {
  const metrics = new RpcMetricsService();
  const config = {
    get: (key: string) => (key === "METRICS_SCRAPE_TOKEN" ? token : undefined),
  } as unknown as ConfigService;
  return { controller: new RpcMetricsController(metrics, config), metrics };
}

function request(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request;
}

describe("RpcMetricsController", () => {
  describe("authorization", () => {
    it("serves the exposition with the right bearer token", async () => {
      const { controller, metrics } = makeController(TOKEN);
      metrics.observeRequest("getNetwork", "quasar", "ok", 5);

      const body = await controller.scrape(request(`Bearer ${TOKEN}`));

      expect(body).toContain("neko_rpc_requests_total");
    });

    it("rejects a wrong token", async () => {
      const { controller } = makeController(TOKEN);

      await expect(
        controller.scrape(request("Bearer wrong-token-of-the-same-len"))
      ).rejects.toThrow();
    });

    it("rejects a request with no Authorization header", async () => {
      const { controller } = makeController(TOKEN);

      await expect(controller.scrape(request())).rejects.toThrow();
    });

    it("rejects a non-Bearer scheme", async () => {
      const { controller } = makeController(TOKEN);

      await expect(
        controller.scrape(request(`Basic ${TOKEN}`))
      ).rejects.toThrow();
    });

    it("refuses everything when no token is configured, rather than opening up", async () => {
      // The exposition leaks traffic shape and upstream endpoint names, so an
      // unset token must fail closed.
      const { controller } = makeController(undefined);

      await expect(
        controller.scrape(request(`Bearer ${TOKEN}`))
      ).rejects.toThrow(/not set/);
    });
  });
});
