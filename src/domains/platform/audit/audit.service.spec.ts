jest.mock("@neko-protocol/keeper", () => ({
  getAssetsConfig: () => ({}),
  getContractToCodeMap: () => ({}),
  getCurrentNetworkId: () => "PUBLIC",
}));

import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { AuditService } from "./audit.service";

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = { method: string; args: unknown[] };

function makeService(result: Result, calls: Call[] = []): AuditService {
  const builder: Record<string, unknown> = {};
  for (const m of [
    "select",
    "insert",
    "eq",
    "order",
    "range",
    "in",
    "gte",
    "not",
    "limit",
  ]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  (builder as { then: unknown }).then = (resolve: (v: Result) => void) =>
    resolve(result);

  const client = {
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder;
    },
  };
  const supabase = { client } as unknown as SupabaseService;
  const config = {
    get: () => "mainnet",
  } as unknown as ConfigService;
  return new AuditService(config, supabase, makeNotifications());
}

/** emit() is fire-and-forget from these services, so a no-op stands in for it. */
function makeNotifications(): NotificationsService {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
}

describe("AuditService read methods", () => {
  it("countMainnet returns the count filtered to mainnet", async () => {
    const calls: Call[] = [];
    const svc = makeService({ count: 7 }, calls);
    expect(await svc.countMainnet()).toBe(7);
    expect(calls).toContainEqual({ method: "from", args: ["audit_logs"] });
    expect(calls).toContainEqual({
      method: "eq",
      args: ["network", "mainnet"],
    });
  });

  it("countMainnet falls back to 0 when count is null", async () => {
    const svc = makeService({ count: undefined });
    expect(await svc.countMainnet()).toBe(0);
  });

  it("query returns rows and applies whereIn/gte/notNull filters", async () => {
    const calls: Call[] = [];
    const svc = makeService({ data: [{ amount_in: 5 }], error: null }, calls);
    const rows = await svc.query("amount_in", {
      whereIn: { column: "wallet_address", values: ["G1"] },
      gte: { column: "created_at", value: "2026-01-01" },
      notNull: "amount_in",
    });
    expect(rows).toEqual([{ amount_in: 5 }]);
    expect(calls).toContainEqual({
      method: "eq",
      args: ["network", "mainnet"],
    });
    expect(calls).toContainEqual({
      method: "in",
      args: ["wallet_address", ["G1"]],
    });
    expect(calls).toContainEqual({
      method: "gte",
      args: ["created_at", "2026-01-01"],
    });
    expect(calls).toContainEqual({
      method: "not",
      args: ["amount_in", "is", null],
    });
  });

  it("query returns [] on error", async () => {
    const svc = makeService({ data: null, error: { message: "boom" } });
    expect(await svc.query("action_type")).toEqual([]);
  });

  it("recent returns ordered rows", async () => {
    const calls: Call[] = [];
    const svc = makeService({ data: [{ id: 1 }], error: null }, calls);
    expect(await svc.recent("id", 5)).toEqual([{ id: 1 }]);
    expect(calls).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
    expect(calls).toContainEqual({ method: "limit", args: [5] });
  });

  it("recent returns [] on error", async () => {
    const svc = makeService({ data: null, error: { message: "boom" } });
    expect(await svc.recent("id", 5)).toEqual([]);
  });

  it("listVaultActivity filters vault actions without the generic 50-row cap", async () => {
    const calls: Call[] = [];
    const svc = makeService({ data: [{ id: 1 }], error: null }, calls);

    expect(await svc.listVaultActivity("GVAULT")).toEqual([{ id: 1 }]);
    expect(calls).toContainEqual({
      method: "eq",
      args: ["wallet_address", "GVAULT"],
    });
    expect(calls).toContainEqual({
      method: "in",
      args: [
        "action_type",
        ["vaults_deposit", "vaults_withdraw", "vaults_claim_earnings"],
      ],
    });
    expect(calls).toContainEqual({ method: "limit", args: [1_000] });
  });

  it("record inserts into audit_logs and reports ok", async () => {
    const calls: Call[] = [];
    const svc = makeService({ error: null }, calls);
    const res = await svc.record({
      wallet_address: "GABC",
      action_type: "vaults_deposit",
      asset_in: "XLM",
      token_amount_in: 10,
      amount_in: 2.5,
      tx_hash: "deadbeef",
    });
    expect(res).toEqual({ ok: true });
    const insert = calls.find((c) => c.method === "insert");
    expect(insert).toBeDefined();
    const row = insert!.args[0] as Record<string, unknown>;
    expect(row.wallet_address).toBe("GABC");
    expect(row.action_type).toBe("vaults_deposit");
    expect(row.network).toBe("mainnet");
    expect(row.asset_out).toBeNull();
  });

  it("record reports the error message on failure", async () => {
    const svc = makeService({ error: { message: "nope" } });
    expect(await svc.record({ wallet_address: "G", action_type: "x" })).toEqual(
      { ok: false, error: "nope" }
    );
  });
});

describe("AuditService notification emission", () => {
  /**
   * `log()` walks insert -> select -> single, then a price lookup and a count.
   * A single queued result per table is enough here: the insert returns the row
   * id, and everything else tolerates the same shape.
   */
  function makeLoggingService(notifications: NotificationsService) {
    const builder: Record<string, unknown> = {};
    for (const m of [
      "select",
      "insert",
      "eq",
      "order",
      "limit",
      "in",
      "single",
      "rpc",
    ]) {
      builder[m] = () => builder;
    }
    (builder as { then: unknown }).then = (resolve: (v: Result) => void) =>
      resolve({ data: { id: "audit-1" }, count: 3 });

    const client = {
      from: () => builder,
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    return new AuditService(
      { get: () => "mainnet" } as unknown as ConfigService,
      { client } as unknown as SupabaseService,
      notifications
    );
  }

  it("emits on every swap, keyed on the audit row so each one is distinct", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const svc = makeLoggingService({ emit } as unknown as NotificationsService);

    await svc.log({
      wallet_address: "GWALLET",
      action_type: "swap",
      asset_in: "XLM",
      asset_out: "USDC",
      token_amount_in: 100,
      amount_out: 12.5,
    } as never);

    expect(emit).toHaveBeenCalledTimes(1);
    const arg = emit.mock.calls[0][0];
    expect(arg.trigger).toBe("swap_completed");
    expect(arg.walletAddress).toBe("GWALLET");
    // Not "first_swap": the count of prior swaps is 3 here and it still fires.
    expect(arg.dedupeKey).toBe("swap:audit-1");
    expect(arg.params).toEqual({
      amount_in: "100",
      asset_in: "XLM",
      amount_out: "12.5",
      asset_out: "USDC",
    });
  });

  it("emits on every deposit with the destination filled in", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const svc = makeLoggingService({ emit } as unknown as NotificationsService);

    await svc.log({
      wallet_address: "GWALLET",
      action_type: "vaults_deposit",
      asset_in: "USDC",
      asset_out: "nUSDC",
      token_amount_in: 250,
      pool_id: "CVAULT",
    } as never);

    const arg = emit.mock.calls[0][0];
    expect(arg.trigger).toBe("first_deposit");
    expect(arg.dedupeKey).toBe("deposit:audit-1");
    expect(arg.params).toMatchObject({
      amount: "250",
      asset: "USDC",
      destination: "nUSDC",
    });
  });

  it("does not emit for actions no trigger covers", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const svc = makeLoggingService({ emit } as unknown as NotificationsService);

    await svc.log({
      wallet_address: "GWALLET",
      action_type: "vaults_withdraw",
      asset_in: "USDC",
      token_amount_in: 10,
    } as never);

    expect(emit).not.toHaveBeenCalled();
  });
});
