import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { StrategyCatalogService } from "./strategy-catalog.service";

describe("StrategyCatalogService", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  async function buildService(env: Record<string, string>) {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => env],
        }),
      ],
      providers: [StrategyCatalogService],
    }).compile();
    return mod.get(StrategyCatalogService);
  }

  it("returns upserted:0 and skips fetch when WEB_APP_URL is not set", async () => {
    const svc = await buildService({});
    const result = await svc.refresh();
    expect(result).toEqual({ upserted: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the web-app refresh endpoint with the bearer cron secret", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ upserted: 7 }), { status: 200 })
    );
    const svc = await buildService({
      WEB_APP_URL: "https://app.example.com/",
      CRON_SECRET: "secret-xyz",
    });
    const result = await svc.refresh();
    expect(result).toEqual({ upserted: 7 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/api/strategies/catalog/refresh",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret-xyz" },
      })
    );
  });

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const svc = await buildService({ WEB_APP_URL: "https://app.example.com" });
    await expect(svc.refresh()).rejects.toThrow(/HTTP 503/);
  });
});
