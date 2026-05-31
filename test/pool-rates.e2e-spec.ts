import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

// AppModule transitively loads @neko/orchestrator (an ESM workspace package);
// stub it so the CJS jest runner does not parse its ESM build.
jest.mock("@neko/orchestrator", () => ({
  createOrchestrator: () => ({
    orchestrator: { getAllPools: jest.fn().mockResolvedValue([]) },
    poolRegistry: { getAdapters: () => [] },
  }),
  setContractErrorExtractor: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { AppModule } from "../src/app.module";
import { PoolRatesService } from "../src/modules/pool-rates/pool-rates.service";

describe("POST /pool-rates/run-now (e2e)", () => {
  let app: INestApplication;
  let recordSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.env.INTERNAL_API_KEY ??= "x".repeat(32);
    process.env.STELLAR_NETWORK ??= "mainnet";
    process.env.STELLAR_NETWORK_PASSPHRASE ??=
      "Public Global Stellar Network ; September 2015";
    process.env.STELLAR_RPC_URL ??= "https://soroban-mainnet.example/rpc";
    process.env.STELLAR_HORIZON_URL ??= "https://horizon.example";
    process.env.SUPABASE_URL ??= "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "stub";

    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    recordSpy = jest
      .spyOn(app.get(PoolRatesService), "recordOnce")
      .mockResolvedValue({ inserted: 2 });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rejects unauthenticated callers", async () => {
    await request(app.getHttpServer()).post("/pool-rates/run-now").expect(401);
  });

  it("runs the job and returns inserted count", async () => {
    const res = await request(app.getHttpServer())
      .post("/pool-rates/run-now")
      .set("x-internal-key", process.env.INTERNAL_API_KEY!)
      .expect(200);
    expect(res.body).toEqual({ inserted: 2 });
    expect(recordSpy).toHaveBeenCalled();
  });
});
