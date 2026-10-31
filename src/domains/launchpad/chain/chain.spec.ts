import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { SupabaseService } from "@core/supabase/supabase.service";
import type { AccountsService } from "../accounts.service";
import type { ApplicationRow } from "../launchpad.types";
import type { LaunchpadChainService, Platform } from "./chain.service";
import { LaunchService, SKIPPED, assertLaunchTerms } from "./launch.service";
import { isoNumeric, signClaim } from "./onchain-identity.service";
import { ChainCallError } from "./soroban";
import {
  canonicalJson,
  expectedRepayment,
  repaymentRateBps,
  splitTranches,
  toUnits,
  vaultIdFor,
} from "./terms";

type Row = Record<string, unknown>;

/** Supabase stand-in that embeds launchpad_deployments like PostgREST does. */
function fakeSupabase() {
  const tables: Record<string, Row[]> = {};
  const rows = (t: string) => (tables[t] ??= []);

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    const embed = (r: Row) =>
      table === "launchpad_applications"
        ? {
            ...r,
            launchpad_deployments:
              rows("launchpad_deployments").find(
                (d) => d.application_id === r.id
              ) ?? null,
          }
        : r;
    const run = () => {
      if (op === "insert") {
        const row = { id: randomUUID(), ...payload };
        rows(table).push(row);
        return [row];
      }
      const hit = rows(table).filter((r) =>
        filters.every(([k, v]) => r[k] === v)
      );
      if (op === "update") hit.forEach((r) => Object.assign(r, payload));
      return hit.map(embed);
    };
    const builder = {
      select: () => builder,
      insert: (v: Row) => ((op = "insert"), (payload = v), builder),
      update: (v: Row) => ((op = "update"), (payload = v), builder),
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    };
    return builder;
  }
  return {
    tables,
    service: { client: { from } } as unknown as SupabaseService,
  };
}

/** A well-formed contract address; arguments are encoded for real. */
const contract = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const CTOKEN = contract(1);
const CCOMPLIANCE = contract(2);
const CVAULT = contract(3);
const CFACTORY = contract(4);
const CTRACKER = contract(5);
const CREGISTRY = contract(6);
const CUSDC = contract(7);
const ISSUER = Keypair.random().publicKey();
const MANAGER = Keypair.random();
const ADMIN = Keypair.random();

function application(overrides: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: randomUUID(),
    account_id: "acct-1",
    status: "approved",
    issuer_name: "Neko Coffee SA",
    issuer_country: "CR",
    asset_name: "Coffee Note",
    asset_type: "agriculture",
    description: "Harvest receivables.",
    target_amount: "250000.00",
    currency: "USD",
    min_ticket: "100.00",
    min_target: "125000.00",
    expected_yield_pct: "9.500",
    term_months: 18,
    max_investors: null,
    offering_type: "public",
    investor_countries: ["CR"],
    accepts_us_investors: false,
    uses_mass_marketing: false,
    milestones: [
      { title: "Permits", amount_pct: 30, due: "2099-03-01" },
      { title: "Structure", amount_pct: 30, due: "2099-06-01" },
      { title: "Handover", amount_pct: 40, due: "2099-09-01" },
    ],
    documents: [],
    ai_summary: null,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function setup(app: ApplicationRow = application()) {
  const db = fakeSupabase();
  db.tables.launchpad_applications = [app as unknown as Row];
  db.tables.launchpad_wallets = [{ account_id: "acct-1", address: ISSUER }];

  let tx = 0;
  const soroban = {
    invoke: jest.fn(
      async (
        ..._args: unknown[]
      ): Promise<{ hash: string; result: unknown }> => ({
        hash: `tx-${++tx}`,
        result: {
          token: CTOKEN,
          compliance: CCOMPLIANCE,
          vault: CVAULT,
          wired: false,
        },
      })
    ),
    read: jest.fn(async (_id: string, method: string) => {
      if (method === "get_deployment")
        return {
          token: CTOKEN,
          compliance: CCOMPLIANCE,
          vault: CVAULT,
          wired: false,
        };
      if (method === "get_admin") return CFACTORY;
      throw new Error(`unexpected read ${method}`);
    }),
  };
  const platform = {
    soroban,
    manager: MANAGER,
    admin: ADMIN,
    factory: CFACTORY,
    milestoneTracker: CTRACKER,
    identityRegistry: CREGISTRY,
    platformAdmin: ADMIN.publicKey(),
    usdc: CUSDC,
    usdcAsset: { getCode: () => "USDC" },
    exitFeeBps: 500,
    maxExitFeeBps: 1000,
    publicApiUrl: "https://api.example",
  } as unknown as Platform;
  const chain = {
    platform: jest.fn().mockResolvedValue(platform),
    hasUsdcTrustline: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<LaunchpadChainService>;
  const accounts = {
    getByAccessToken: jest
      .fn()
      .mockResolvedValue({ account: { id: "acct-1" } }),
  } as unknown as AccountsService;

  const service = new LaunchService(db.service, accounts, chain);
  return { db, soroban, chain, service, app };
}

const LAUNCH = {
  token_symbol: "COFFEE",
  funding_deadline: "2099-01-15T00:00:00Z",
};

describe("vault terms", () => {
  it("matches the Launchpad's repayment arithmetic", () => {
    const total = expectedRepayment(toUnits(250000), repaymentRateBps(9.5, 18));
    expect(total).toBe(2_856_250_000_000n);
    expect(splitTranches(total, [30, 30, 40])).toEqual([
      856_875_000_000n,
      856_875_000_000n,
      1_142_500_000_000n,
    ]);
  });

  it("gives the remainder to the last tranche", () => {
    const parts = splitTranches(100n, [33.33, 33.33, 33.34]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it("derives a stable vault id and metadata hash input", () => {
    expect(vaultIdFor("a")).toBe(vaultIdFor("a"));
    expect(vaultIdFor("a")).toHaveLength(64);
    expect(
      canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })
    ).toBe('{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}');
  });
});

describe("assertLaunchTerms", () => {
  const app = application();
  it.each([
    ["a lowercase symbol", "coffee", LAUNCH.funding_deadline],
    ["a past deadline", "COFFEE", "2020-01-01T00:00:00Z"],
    ["a deadline after the first repayment", "COFFEE", "2099-04-01T00:00:00Z"],
  ])("rejects %s", (_, symbol, deadline) => {
    expect(() => assertLaunchTerms(app, symbol, deadline)).toThrow(
      BadRequestException
    );
  });

  it("rejects an application without a minimum raise", () => {
    expect(() =>
      assertLaunchTerms(
        application({ min_target: null }),
        LAUNCH.token_symbol,
        LAUNCH.funding_deadline
      )
    ).toThrow(BadRequestException);
  });

  it("accepts valid terms", () => {
    expect(() =>
      assertLaunchTerms(app, LAUNCH.token_symbol, LAUNCH.funding_deadline)
    ).not.toThrow();
  });
});

describe("LaunchService", () => {
  it("runs every step and goes live", async () => {
    const { service, soroban, app } = setup();
    const view = await service.launch("token", app.id, LAUNCH);

    expect(view.deployment?.status).toBe("live");
    expect(view.deployment?.vault).toBe(CVAULT);
    expect(view.deployment?.vault_id).toBe(vaultIdFor(app.id));
    expect(Object.keys(view.deployment!.steps)).toEqual([
      "create_vault",
      "wire_vault",
      "accept_admin",
      "bind_compliance",
      "bind_registry",
      "register_milestones",
    ]);
    const methods = soroban.invoke.mock.calls.map((c) => (c as unknown[])[2]);
    expect(methods).toEqual([
      "create_vault",
      "wire_vault",
      "accept_admin_transfer",
      "bind_token",
      "bind_token",
      "register_vault",
    ]);
  });

  it("records a failed step and resumes from it", async () => {
    const { service, soroban, app } = setup();
    soroban.invoke
      .mockResolvedValueOnce({
        hash: "tx-create",
        result: {
          token: CTOKEN,
          compliance: CCOMPLIANCE,
          vault: CVAULT,
          wired: false,
        },
      })
      .mockRejectedValueOnce(new ChainCallError("rpc down", null));

    const failed = await service.launch("token", app.id, LAUNCH);
    expect(failed.deployment?.status).toBe("failed");
    expect(failed.deployment?.error?.step).toBe("wire_vault");
    expect(failed.deployment?.steps.create_vault).toBe("tx-create");

    soroban.invoke.mockClear();
    const resumed = await service.launch("token", app.id, {
      ...LAUNCH,
      token_symbol: "OTHER",
    });
    expect(resumed.deployment?.status).toBe("live");
    // The vault already exists, so its symbol stays.
    expect(resumed.deployment?.token_symbol).toBe("COFFEE");
    const methods = soroban.invoke.mock.calls.map((c) => (c as unknown[])[2]);
    expect(methods).not.toContain("create_vault");
  });

  it("tolerates steps that already happened on-chain", async () => {
    const { service, soroban, app } = setup();
    soroban.invoke.mockImplementation(async (...args: unknown[]) => {
      const method = args[2];
      if (method === "create_vault")
        throw new ChainCallError("Error(Contract, #1)", 1);
      if (method === "bind_token")
        throw new ChainCallError("Error(Contract, #331)", 331);
      if (method === "register_vault")
        throw new ChainCallError("Error(Contract, #1)", 1);
      return { hash: `tx-${method}`, result: undefined };
    });

    const view = await service.launch("token", app.id, LAUNCH);
    expect(view.deployment?.status).toBe("live");
    expect(view.deployment?.token).toBe(CTOKEN);
    expect(view.deployment?.steps).toMatchObject({
      create_vault: SKIPPED,
      bind_compliance: SKIPPED,
      bind_registry: SKIPPED,
      register_milestones: SKIPPED,
    });
  });

  it("needs a USDC trustline on the issuer wallet", async () => {
    const { service, chain, app, db } = setup();
    chain.hasUsdcTrustline.mockResolvedValue(false);
    await expect(service.launch("token", app.id, LAUNCH)).rejects.toMatchObject(
      {
        response: { code: "TRUSTLINE_MISSING" },
      }
    );
    expect(db.tables.launchpad_deployments ?? []).toHaveLength(0);
  });

  it("only launches approved applications of the caller", async () => {
    const pending = setup(application({ status: "in_review" }));
    await expect(
      pending.service.launch("token", pending.app.id, LAUNCH)
    ).rejects.toMatchObject({ response: { code: "APPLICATION_NOT_APPROVED" } });

    const other = setup(application({ account_id: "someone-else" }));
    await expect(
      other.service.launch("token", other.app.id, LAUNCH)
    ).rejects.toMatchObject({ response: { code: "APPLICATION_NOT_FOUND" } });
  });
});

describe("investor claims", () => {
  it("signs 16 bytes of validity with a 96-byte key-and-signature", () => {
    const seed = Buffer.alloc(32, 7);
    const { data, signature } = signClaim(
      seed,
      "Test SDF Network ; September 2015",
      "CBYUESUTVUB4NV7PV63DYZYVK2DUIWASUKK55RBG7BVQLOZ2YCEJ76T4",
      "CBZ6CLFDKALOASYTVL36KLBWMFJXTFN77BK5HO5GVP37MKO5ZNCEUI63",
      1,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(data).toHaveLength(16);
    expect(data.readBigUInt64BE(8) - data.readBigUInt64BE(0)).toBe(
      365n * 86_400n
    );
    expect(signature).toHaveLength(96);
    expect(signature.subarray(0, 32)).toEqual(
      Keypair.fromRawEd25519Seed(seed).rawPublicKey()
    );
  });

  it("maps countries to ISO numeric codes", () => {
    expect(isoNumeric("CR")).toBe(188);
    expect(isoNumeric("mx")).toBe(484);
    expect(isoNumeric(null)).toBe(188);
  });
});
