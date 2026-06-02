import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

const mockAdapters = [
  { type: "blend" },
  { type: "soroswap" },
  { type: "aqua" },
];
const mockOrchestrator = { __mock: "orchestrator" };
const mockPoolRegistry = {
  getAdapters: jest.fn().mockReturnValue(mockAdapters),
};
const createOrchestratorMock = jest.fn().mockReturnValue({
  orchestrator: mockOrchestrator,
  poolRegistry: mockPoolRegistry,
});
const setContractErrorExtractorMock = jest.fn();

jest.mock("@neko/orchestrator", () => ({
  createOrchestrator: createOrchestratorMock,
  setContractErrorExtractor: setContractErrorExtractorMock,
}));

import { OrchestratorService } from "./orchestrator.service";

describe("OrchestratorService", () => {
  beforeEach(() => {
    createOrchestratorMock.mockClear();
    setContractErrorExtractorMock.mockClear();
  });

  it("constructs an Orchestrator from env config", async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              STELLAR_NETWORK: "mainnet",
              STELLAR_NETWORK_PASSPHRASE:
                "Public Global Stellar Network ; September 2015",
              STELLAR_RPC_URL: "https://soroban-mainnet.example/rpc",
              STELLAR_HORIZON_URL: "https://horizon-mainnet.example",
            }),
          ],
        }),
      ],
      providers: [OrchestratorService],
    }).compile();

    const svc = mod.get(OrchestratorService);
    expect(svc.orchestrator).toBe(mockOrchestrator);
    expect(setContractErrorExtractorMock).toHaveBeenCalledTimes(1);
    expect(createOrchestratorMock).toHaveBeenCalledTimes(1);
    const cfg = createOrchestratorMock.mock.calls[0][0];
    expect(cfg.network).toEqual({
      id: "PUBLIC",
      rpcUrl: "https://soroban-mainnet.example/rpc",
      passphrase: "Public Global Stellar Network ; September 2015",
      horizonUrl: "https://horizon-mainnet.example",
      allowHttp: false,
    });
    expect(cfg.contractToCodeMap).toEqual({});

    const types = svc.poolRegistry
      .getAdapters()
      .map((a: { type: string }) => a.type)
      .sort();
    expect(types).toContain("blend");
    expect(types).toContain("soroswap");
    expect(types).toContain("aqua");
  });

  it("maps testnet network id", async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              STELLAR_NETWORK: "testnet",
              STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
              STELLAR_RPC_URL: "http://localhost:8000/rpc",
            }),
          ],
        }),
      ],
      providers: [OrchestratorService],
    }).compile();

    mod.get(OrchestratorService);
    const cfg = createOrchestratorMock.mock.calls[0][0];
    expect(cfg.network.id).toBe("TESTNET");
    expect(cfg.network.allowHttp).toBe(true);
  });
});
