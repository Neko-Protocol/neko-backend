import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import type { SupabaseService } from "@core/supabase/supabase.service";
import type { DiditService } from "@core/didit/didit.service";
import type { PrivyService } from "@core/privy/privy.service";
import { fundWithFriendbot } from "@shared/stellar/friendbot";
import { AccountsService } from "./accounts.service";
import { VerificationsService } from "./verifications.service";

jest.mock("@shared/stellar/friendbot", () => ({
  fundWithFriendbot: jest.fn(),
}));

type Row = Record<string, unknown>;

function fakeSupabase() {
  const tables: Record<string, Row[]> = {};
  const rows = (t: string) => (tables[t] ??= []);

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row = {};
    const match = () =>
      rows(table).filter((r) => filters.every(([k, v]) => r[k] === v));
    const run = () => {
      if (op === "insert") {
        const row = {
          id: randomUUID(),
          claimed_at: null,
          provider_session_id: null,
          ...payload,
        };
        rows(table).push(row);
        return [row];
      }
      if (op === "update") {
        const hit = match();
        hit.forEach((r) => Object.assign(r, payload));
        return hit;
      }
      if (op === "delete") {
        const hit = match();
        tables[table] = rows(table).filter((r) => !hit.includes(r));
        return hit;
      }
      return match();
    };
    const builder = {
      select: () => builder,
      insert: (v: Row) => ((op = "insert"), (payload = v), builder),
      update: (v: Row) => ((op = "update"), (payload = v), builder),
      delete: () => ((op = "delete"), builder),
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: run(), error: null }),
    };
    return builder;
  }

  return {
    tables,
    service: { client: { from } } as unknown as SupabaseService,
  };
}

function config(env: Record<string, string>) {
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

const BASE_ENV = {
  DIDIT_KYC_WORKFLOW_ID: "11111111-1111-1111-1111-111111111111",
  LAUNCHPAD_APP_URL: "http://localhost:3000",
  KYC_MOCK_ENABLED: "true",
};

function setup(env: Record<string, string> = BASE_ENV) {
  const db = fakeSupabase();
  const didit = {
    isConfigured: () => true,
    createSession: jest.fn().mockResolvedValue({
      session_id: "sess-1",
      url: "https://verify.didit.me/session/x",
      status: "Not Started",
    }),
    getDecision: jest.fn().mockResolvedValue({
      session_id: "sess-1",
      status: "Approved",
      id_verifications: [{ first_name: "Ana", last_name: "Mora" }],
    }),
  } as unknown as jest.Mocked<DiditService>;
  const privy = {
    verifyAccessToken: jest
      .fn()
      .mockResolvedValue({ userId: "did:privy:1", sessionId: "s" }),
    ensureUserWithStellarWallet: jest.fn().mockResolvedValue({
      userId: "did:privy:1",
      email: "ana@x.com",
      stellarWallets: [],
      wallet: { address: "GWALLET", walletId: "w-1" },
    }),
  } as unknown as jest.Mocked<PrivyService>;
  const verifications = new VerificationsService(
    db.service,
    didit,
    config(env)
  );
  const accounts = new AccountsService(
    db.service,
    privy,
    verifications,
    config(env)
  );
  return { db, didit, privy, verifications, accounts };
}

beforeEach(() => {
  (fundWithFriendbot as jest.Mock).mockResolvedValue({
    funded: true,
    txHash: "tx-1",
  });
});

describe("VerificationsService", () => {
  it("starts a Didit session bound to the verification id", async () => {
    const { verifications, didit, db } = setup();
    const started = await verifications.start("kyc");

    expect(didit.createSession).toHaveBeenCalledWith({
      workflowId: BASE_ENV.DIDIT_KYC_WORKFLOW_ID,
      vendorData: started.verification.id,
      callback: "http://localhost:3000/didit-callback",
      metadata: { verification_id: started.verification.id, kind: "kyc" },
    });
    expect(started.session_url).toContain("didit.me");
    const row = db.tables.launchpad_verifications[0];
    expect(row.provider_session_id).toBe("sess-1");
    expect(row.claim_token_hash).not.toBe(started.claim_token);
  });

  it("refuses KYB when its workflow is not configured", async () => {
    const { verifications } = setup();
    await expect(verifications.start("kyb")).rejects.toMatchObject({
      response: { code: "WORKFLOW_NOT_CONFIGURED" },
    });
  });

  it("pulls the decision and stores the verified name", async () => {
    const { verifications } = setup();
    const started = await verifications.start("kyc");
    const view = await verifications.get(
      started.verification.id,
      started.claim_token
    );
    expect(view).toMatchObject({ status: "approved", full_name: "Ana Mora" });
  });

  it("rejects a wrong claim token", async () => {
    const { verifications } = setup();
    const started = await verifications.start("kyc");
    await expect(
      verifications.get(started.verification.id, "nope")
    ).rejects.toMatchObject({ response: { code: "CLAIM_TOKEN_INVALID" } });
  });

  it("hides the mock endpoint unless KYC_MOCK_ENABLED=true", async () => {
    const { verifications } = setup({ ...BASE_ENV, KYC_MOCK_ENABLED: "" });
    await expect(
      verifications.startMock("kyc", "Demo Judge")
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates an approved mock verification with the typed name", async () => {
    const { verifications, didit } = setup();
    const started = await verifications.startMock("kyb", "  Neko Coffee  ");
    expect(started.verification).toMatchObject({
      provider: "mock",
      status: "approved",
      business_name: "Neko Coffee",
      full_name: null,
    });
    expect(didit.createSession).not.toHaveBeenCalled();
  });
});

describe("AccountsService", () => {
  it("creates the account and a wallet linked to the verification", async () => {
    const { verifications, accounts, privy, db } = setup();
    const started = await verifications.startMock("kyc", "Demo Judge");

    const result = await accounts.create(
      started.verification.id,
      started.claim_token,
      " Ana@X.com "
    );

    expect(privy.ensureUserWithStellarWallet).toHaveBeenCalledWith(
      "ana@x.com",
      {
        launchpad_verification_id: started.verification.id,
        launchpad_kind: "kyc",
      }
    );
    expect(result.wallet).toEqual({
      address: "GWALLET",
      network: "testnet",
      funded: true,
      funding_tx_hash: "tx-1",
    });
    expect(result.verification.claimed).toBe(true);
    const wallet = db.tables.launchpad_wallets[0];
    expect(wallet.verification_id).toBe(started.verification.id);
    expect(wallet.account_id).toBe(result.account.id);
    expect(db.tables.launchpad_accounts[0].display_name).toBe("Demo Judge");
  });

  it("is idempotent for the same verification and email", async () => {
    const { verifications, accounts, privy } = setup();
    const started = await verifications.startMock("kyc", "Demo Judge");
    const first = await accounts.create(
      started.verification.id,
      started.claim_token,
      "ana@x.com"
    );
    const second = await accounts.create(
      started.verification.id,
      started.claim_token,
      "ana@x.com"
    );
    expect(second).toEqual(first);
    expect(privy.ensureUserWithStellarWallet).toHaveBeenCalledTimes(1);
  });

  it("refuses a verification that is not approved", async () => {
    const { verifications, accounts, didit } = setup();
    didit.getDecision.mockResolvedValue({
      session_id: "sess-1",
      status: "In Review",
    });
    const started = await verifications.start("kyc");
    await expect(
      accounts.create(started.verification.id, started.claim_token, "a@x.com")
    ).rejects.toMatchObject({
      response: { code: "VERIFICATION_NOT_APPROVED" },
    });
  });

  it("refuses an email already used by another verification", async () => {
    const { verifications, accounts } = setup();
    const a = await verifications.startMock("kyc", "A");
    const b = await verifications.startMock("kyc", "B");
    await accounts.create(a.verification.id, a.claim_token, "same@x.com");
    await expect(
      accounts.create(b.verification.id, b.claim_token, "same@x.com")
    ).rejects.toMatchObject({ response: { code: "EMAIL_IN_USE" } });
  });

  it("still creates the account when friendbot fails", async () => {
    (fundWithFriendbot as jest.Mock).mockResolvedValue({
      funded: false,
      txHash: null,
      error: "HTTP 500",
    });
    const { verifications, accounts } = setup();
    const started = await verifications.startMock("kyc", "Demo Judge");
    const result = await accounts.create(
      started.verification.id,
      started.claim_token,
      "ana@x.com"
    );
    expect(result.wallet.funded).toBe(false);
  });

  it("returns the account for the logged-in Privy user", async () => {
    const { verifications, accounts } = setup();
    const started = await verifications.startMock("kyc", "Demo Judge");
    const created = await accounts.create(
      started.verification.id,
      started.claim_token,
      "ana@x.com"
    );
    await expect(accounts.getByAccessToken("token")).resolves.toEqual(created);
  });

  it("answers ACCOUNT_NOT_FOUND for a Privy user that never onboarded", async () => {
    const { accounts } = setup();
    await expect(accounts.getByAccessToken("token")).rejects.toMatchObject({
      response: { code: "ACCOUNT_NOT_FOUND" },
    });
  });
});
