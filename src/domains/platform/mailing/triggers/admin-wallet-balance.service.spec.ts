import { ConfigService } from "@nestjs/config";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { AdminWalletBalanceService } from "./admin-wallet-balance.service";

const KEYPAIR = Keypair.random();
const SECRET = KEYPAIR.secret();
const DERIVED = KEYPAIR.publicKey();
const EXPLICIT = Keypair.random().publicKey();

function build(
  env: Record<string, string | undefined>,
  loadAccount: jest.Mock = jest.fn()
) {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const stellar = { horizon: { loadAccount } } as unknown as StellarRpcService;
  return new AdminWalletBalanceService(config, stellar);
}

function account(balances: { asset_type: string; balance: string }[]) {
  return { balances };
}

describe("AdminWalletBalanceService", () => {
  describe("address", () => {
    it("prefers an explicitly configured address", () => {
      const svc = build({
        ADMIN_WALLET_ADDRESS: EXPLICIT,
        VAULT_MANAGER_SECRET_KEY: SECRET,
      });
      expect(svc.address).toBe(EXPLICIT);
    });

    it("falls back to the keeper wallet, which is the account that pays fees", () => {
      const svc = build({ VAULT_MANAGER_SECRET_KEY: SECRET });
      expect(svc.address).toBe(DERIVED);
    });

    it("is null when neither is configured", () => {
      expect(build({}).address).toBeNull();
    });

    it("is null rather than throwing on a malformed secret", () => {
      expect(
        build({ VAULT_MANAGER_SECRET_KEY: "not-a-secret" }).address
      ).toBeNull();
    });
  });

  describe("getXlmBalance", () => {
    it("reads the native balance, ignoring other assets", async () => {
      const loadAccount = jest.fn().mockResolvedValue(
        account([
          { asset_type: "credit_alphanum4", balance: "999.0" },
          { asset_type: "native", balance: "42.5" },
        ])
      );
      const svc = build({ VAULT_MANAGER_SECRET_KEY: SECRET }, loadAccount);
      await expect(svc.getXlmBalance()).resolves.toBe(42.5);
      expect(loadAccount).toHaveBeenCalledWith(DERIVED);
    });

    it("returns null when no wallet is configured, without calling Horizon", async () => {
      const loadAccount = jest.fn();
      const svc = build({}, loadAccount);
      await expect(svc.getXlmBalance()).resolves.toBeNull();
      expect(loadAccount).not.toHaveBeenCalled();
    });

    it("returns null when Horizon fails, so a lookup outage cannot read as a zero balance", async () => {
      const loadAccount = jest.fn().mockRejectedValue(new Error("404"));
      const svc = build({ VAULT_MANAGER_SECRET_KEY: SECRET }, loadAccount);
      await expect(svc.getXlmBalance()).resolves.toBeNull();
    });

    it("returns null when the account holds no native balance entry", async () => {
      const loadAccount = jest.fn().mockResolvedValue(account([]));
      const svc = build({ VAULT_MANAGER_SECRET_KEY: SECRET }, loadAccount);
      await expect(svc.getXlmBalance()).resolves.toBeNull();
    });
  });
});
