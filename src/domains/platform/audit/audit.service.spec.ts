jest.mock("@neko/keeper", () => ({
  getAssetsConfig: () => ({}),
  getContractToCodeMap: () => ({}),
  getCurrentNetworkId: () => "PUBLIC",
}));

import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";
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
  return new AuditService(config, supabase);
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

  it("record inserts into audit_logs and reports ok", async () => {
    const calls: Call[] = [];
    const svc = makeService({ error: null }, calls);
    const res = await svc.record({
      wallet_address: "GABC",
      action_type: "activation_payout",
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
    expect(row.action_type).toBe("activation_payout");
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
