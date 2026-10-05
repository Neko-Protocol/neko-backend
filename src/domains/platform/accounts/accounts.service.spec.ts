import { Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrivyService } from "@core/privy/privy.service";
import type { PrivyUserProfile } from "@core/privy/privy.types";
import { FakeSupabase } from "../../../../test/helpers/fake-supabase";
import { AccountsService } from "./accounts.service";

const PRINCIPAL = { userId: "did:privy:ana", sessionId: "s1" };
const ADDRESS = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV6OJP7TQSLX";

function setup(profile: Partial<PrivyUserProfile> = {}, network = "testnet") {
  const db = new FakeSupabase();
  const privy = {
    getUser: jest.fn(async () => ({
      userId: PRINCIPAL.userId,
      email: "ana@example.com",
      stellarWallets: [{ address: ADDRESS, walletId: "pw_1" }],
      ...profile,
    })),
  };
  const config = {
    get: (k: string) => (k === "STELLAR_NETWORK" ? network : undefined),
  } as unknown as ConfigService;
  const service = new AccountsService(
    db.asService(),
    privy as unknown as PrivyService,
    config
  );
  return { db, privy, service };
}

describe("AccountsService", () => {
  beforeAll(() => Logger.overrideLogger(false));

  describe("bootstrap", () => {
    it("creates account, identity and primary wallet on first call", async () => {
      const { db, service } = setup();

      const res = await service.bootstrap(PRINCIPAL);

      expect(res.created).toBe(true);
      expect(res.needs_profile).toBe(true);
      expect(res.account.email).toBe("ana@example.com");
      expect(res.wallets).toEqual([
        expect.objectContaining({
          address: ADDRESS,
          network: "testnet",
          kind: "embedded",
          is_primary: true,
          activation_status: "not_activated",
        }),
      ]);
      expect(db.rows("account_identities")).toEqual([
        expect.objectContaining({
          provider: "privy",
          provider_subject: PRINCIPAL.userId,
          account_id: res.account.id,
        }),
      ]);
      expect(db.rows("wallets")[0]).toMatchObject({
        provider: "privy",
        provider_wallet_id: "pw_1",
      });
    });

    it("is idempotent", async () => {
      const { db, service } = setup();
      const first = await service.bootstrap(PRINCIPAL);
      const second = await service.bootstrap(PRINCIPAL);

      expect(second.created).toBe(false);
      expect(second.account.id).toBe(first.account.id);
      expect(db.rows("accounts")).toHaveLength(1);
      expect(db.rows("wallets")).toHaveLength(1);
    });

    it("works before the wallet exists, then adds it on the next call", async () => {
      const { db, privy, service } = setup({ stellarWallets: [] });
      const first = await service.bootstrap(PRINCIPAL);
      expect(first.wallets).toEqual([]);

      privy.getUser.mockResolvedValueOnce({
        userId: PRINCIPAL.userId,
        email: "ana@example.com",
        stellarWallets: [{ address: ADDRESS, walletId: "pw_1" }],
      });
      const second = await service.bootstrap(PRINCIPAL);
      expect(second.wallets).toHaveLength(1);
      expect(second.wallets[0].is_primary).toBe(true);
      expect(db.rows("accounts")).toHaveLength(1);
    });

    it("resolves a concurrent bootstrap to one account", async () => {
      const { db, service } = setup();
      const [a, b] = await Promise.all([
        service.bootstrap(PRINCIPAL),
        service.bootstrap(PRINCIPAL),
      ]);
      expect(a.account.id).toBe(b.account.id);
      expect(db.rows("accounts")).toHaveLength(1);
      expect(db.rows("account_identities")).toHaveLength(1);
    });

    it("never reassigns a wallet owned by another account", async () => {
      const { db, service } = setup();
      await service.bootstrap(PRINCIPAL);

      const other = await service.bootstrap({
        userId: "did:privy:mallory",
        sessionId: "s2",
      });
      expect(other.wallets).toEqual([]);
      expect(db.rows("wallets")).toHaveLength(1);
    });

    it("tags wallets with the mainnet network on a mainnet backend", async () => {
      const { service } = setup({}, "PUBLIC");
      const res = await service.bootstrap(PRINCIPAL);
      expect(res.wallets[0].network).toBe("mainnet");
    });
  });

  describe("me / profile", () => {
    it("me throws ACCOUNT_NOT_FOUND before bootstrap", async () => {
      const { service } = setup();
      await expect(service.me(PRINCIPAL)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it("updateProfile stores answers and the terms acceptance time", async () => {
      const { service } = setup();
      await service.bootstrap(PRINCIPAL);

      const res = await service.updateProfile(PRINCIPAL, {
        display_name: " Ana ",
        country: "CR",
        locale: "es",
        terms_version: "2026-10-05",
      });

      expect(res.account).toMatchObject({
        display_name: "Ana",
        country: "CR",
        locale: "es",
        terms_version: "2026-10-05",
      });
      expect(res.account.terms_accepted_at).toEqual(expect.any(String));
      expect(res.needs_profile).toBe(false);
    });

    it("requirePrimaryWallet returns WALLET_NOT_FOUND without a wallet", async () => {
      const { service } = setup({ stellarWallets: [] });
      await service.bootstrap(PRINCIPAL);
      await expect(
        service.requirePrimaryWallet(PRINCIPAL)
      ).rejects.toMatchObject({ response: { code: "WALLET_NOT_FOUND" } });
    });
  });
});
