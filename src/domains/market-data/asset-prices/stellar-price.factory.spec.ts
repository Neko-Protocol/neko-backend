import { ConfigService } from "@nestjs/config";

const reflectorCtor = jest.fn();
jest.mock("@neko/reflector", () => ({
  Client: jest.fn().mockImplementation((opts) => {
    reflectorCtor(opts);
    return { lastprice: jest.fn() };
  }),
}));

jest.mock("@neko/keeper", () => ({
  StellarPriceService: jest.fn().mockImplementation((deps) => ({ deps })),
  getAssetsConfig: jest.fn().mockReturnValue({
    USDC: { code: "USDC", contract: "C_USDC", decimals: 7 },
  }),
  getCurrentNetworkId: jest.fn().mockReturnValue("mainnet"),
}));

import { createStellarPriceService } from "./stellar-price.factory";
import type { StellarRpcService } from "@core/stellar/stellar-rpc.service";

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    STELLAR_NETWORK: "mainnet",
    STELLAR_NETWORK_PASSPHRASE:
      "Public Global Stellar Network ; September 2015",
    STELLAR_RPC_URL: "https://single-endpoint.example",
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe("createStellarPriceService", () => {
  beforeEach(() => reflectorCtor.mockClear());

  it("does not build the Reflector client while providers are constructing", () => {
    // The pool proxy does not exist until StellarRpcService's onModuleInit.
    // Building here would capture undefined, the SDK would fall back to the
    // single-endpoint URL, and the oracle would be off the pool — invisibly,
    // because a failed oracle read returns 0 and the chain moves on.
    let poolReady = false;
    const stellarRpc = {
      get rpc() {
        if (!poolReady) throw new Error("read the pool before it was ready");
        return { simulateTransaction: jest.fn() };
      },
    } as unknown as StellarRpcService;

    const service = createStellarPriceService(makeConfig(), stellarRpc);

    expect(reflectorCtor).not.toHaveBeenCalled();

    poolReady = true;
    const deps = (
      service as unknown as { deps: { getReflectorClient: () => unknown } }
    ).deps;
    expect(deps.getReflectorClient()).not.toBeNull();
    expect(reflectorCtor).toHaveBeenCalledTimes(1);
  });

  it("hands the Reflector client the pool rather than the single endpoint", () => {
    const pooled = { simulateTransaction: jest.fn() };
    const stellarRpc = { rpc: pooled } as unknown as StellarRpcService;

    const service = createStellarPriceService(makeConfig(), stellarRpc);
    const deps = (
      service as unknown as { deps: { getReflectorClient: () => unknown } }
    ).deps;
    deps.getReflectorClient();

    // Without this the oracle silently bypasses failover, which is the whole
    // point of routing it through the pool.
    expect(reflectorCtor).toHaveBeenCalledWith(
      expect.objectContaining({ server: pooled })
    );
  });

  it("builds the client once and reuses it", () => {
    const stellarRpc = { rpc: {} } as unknown as StellarRpcService;
    const service = createStellarPriceService(makeConfig(), stellarRpc);
    const deps = (
      service as unknown as { deps: { getReflectorClient: () => unknown } }
    ).deps;

    deps.getReflectorClient();
    deps.getReflectorClient();

    expect(reflectorCtor).toHaveBeenCalledTimes(1);
  });

  it("returns no client off mainnet, where Reflector does not exist", () => {
    const stellarRpc = { rpc: {} } as unknown as StellarRpcService;
    const service = createStellarPriceService(
      makeConfig({ STELLAR_NETWORK: "testnet" }),
      stellarRpc
    );
    const deps = (
      service as unknown as { deps: { getReflectorClient: () => unknown } }
    ).deps;

    expect(deps.getReflectorClient()).toBeNull();
    expect(reflectorCtor).not.toHaveBeenCalled();
  });
});
