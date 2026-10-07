import { SupabaseService } from "@core/supabase/supabase.service";
import { NotificationsService } from "./notifications.service";
import { PushService } from "./push/push.service";

function makePush() {
  return { sendToWallet: jest.fn() } as unknown as PushService & {
    sendToWallet: jest.Mock;
  };
}

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = { table: string; method: string; args: unknown[] };

/**
 * Minimal PostgREST stand-in: every builder method records its call and
 * returns the builder, and awaiting the builder yields the queued result.
 */
function makeDb(results: Record<string, Result[]>) {
  const queues = new Map<string, Result[]>(
    Object.entries(results).map(([k, v]) => [k, [...v]])
  );
  const calls: Call[] = [];

  const makeBuilder = (table: string) => {
    const result = () => queues.get(table)?.shift() ?? { data: null };
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "upsert",
      "update",
      "delete",
      "eq",
      "in",
      "is",
      "order",
      "limit",
      "range",
      "maybeSingle",
    ]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    (builder as { then: unknown }).then = (resolve: (v: Result) => void) =>
      resolve(result());
    return builder;
  };

  const supabase = {
    client: {
      from: (table: string) => makeBuilder(table),
    },
  } as unknown as SupabaseService;

  return { supabase, calls };
}

const ACTIVE_MESSAGE = {
  id: "msg-1",
  title: "Welcome, {{name}}",
  body: "You swapped {{amount}} today. {{missing}} stays put.",
  url: "/dashboard",
  category: "reward",
};

describe("NotificationsService.emit", () => {
  it("writes a substituted, deduped row when the trigger has an active message", async () => {
    const db = makeDb({
      notification_messages: [{ data: ACTIVE_MESSAGE }],
      notifications: [{ data: [{ id: "n-1" }] }],
    });
    const svc = new NotificationsService(db.supabase, makePush());

    await svc.emit({
      trigger: "swap_completed",
      walletAddress: "  GWALLET  ",
      dedupeKey: "first_swap",
      params: { name: "Ada", amount: 42 },
    });

    const upsert = db.calls.find((c) => c.method === "upsert");
    expect(upsert).toBeDefined();
    const [rows, options] = upsert!.args as [
      Record<string, unknown>[],
      Record<string, unknown>,
    ];

    expect(rows[0]).toMatchObject({
      wallet_address: "GWALLET",
      message_id: "msg-1",
      title: "Welcome, Ada",
      category: "reward",
      trigger_type: "swap_completed",
      dedupe_key: "first_swap",
    });
    // An unmatched placeholder is left verbatim rather than blanked, so a
    // missing param reads as a template bug instead of a silent gap.
    expect(rows[0].body).toBe("You swapped 42 today. {{missing}} stays put.");
    expect(options).toEqual({
      onConflict: "wallet_address,dedupe_key",
      ignoreDuplicates: true,
    });
  });

  it("writes nothing when no active message exists for the trigger", async () => {
    const db = makeDb({ notification_messages: [{ data: null }] });
    const svc = new NotificationsService(db.supabase, makePush());

    await svc.emit({
      trigger: "signup",
      walletAddress: "GWALLET",
      dedupeKey: "signup",
    });

    expect(db.calls.some((c) => c.method === "upsert")).toBe(false);
  });

  it("swallows a write failure so the caller's action still succeeds", async () => {
    const db = makeDb({
      notification_messages: [{ data: ACTIVE_MESSAGE }],
      notifications: [{ error: { message: "boom" } }],
    });
    const svc = new NotificationsService(db.supabase, makePush());

    await expect(
      svc.emit({
        trigger: "signup",
        walletAddress: "GWALLET",
        dedupeKey: "signup",
      })
    ).resolves.toBeUndefined();
  });

  it("ignores an emit with no wallet or no dedupe key", async () => {
    const db = makeDb({});
    const svc = new NotificationsService(db.supabase, makePush());

    await svc.emit({ trigger: "signup", walletAddress: "", dedupeKey: "x" });
    await svc.emit({ trigger: "signup", walletAddress: "G", dedupeKey: "  " });

    expect(db.calls).toHaveLength(0);
  });
});

describe("NotificationsService.markRead", () => {
  it("scopes the update to the wallet and to unread rows", async () => {
    const db = makeDb({ notifications: [{ data: [{ id: "n-1" }] }] });
    const svc = new NotificationsService(db.supabase, makePush());

    const result = await svc.markRead("GWALLET", ["n-1", "n-1", "n-2"]);

    expect(result).toEqual({ updated: 1 });
    expect(db.calls).toEqual(
      expect.arrayContaining([
        {
          table: "notifications",
          method: "eq",
          args: ["wallet_address", "GWALLET"],
        },
        { table: "notifications", method: "is", args: ["read_at", null] },
        // Duplicates collapsed before the IN list is built.
        { table: "notifications", method: "in", args: ["id", ["n-1", "n-2"]] },
      ])
    );
  });

  it("does not issue an update for an empty id list", async () => {
    const db = makeDb({});
    const svc = new NotificationsService(db.supabase, makePush());

    await expect(svc.markRead("GWALLET", [])).resolves.toEqual({ updated: 0 });
    expect(db.calls).toHaveLength(0);
  });
});

describe("NotificationsService push channel", () => {
  it("pushes the same title and body when the in-app row is new", async () => {
    const db = makeDb({
      notification_messages: [{ data: ACTIVE_MESSAGE }],
      notifications: [{ data: [{ id: "n-1" }] }],
    });
    const push = makePush();
    const svc = new NotificationsService(db.supabase, push);

    await svc.emit({
      trigger: "tx_confirmed",
      walletAddress: "GWALLET",
      dedupeKey: "tx:abc",
      params: { name: "Ana", amount: 5 },
    });

    expect(push.sendToWallet).toHaveBeenCalledWith("GWALLET", {
      title: "Welcome, Ana",
      body: "You swapped 5 today. {{missing}} stays put.",
      data: { trigger: "tx_confirmed" },
    });
  });

  it("does not push again when the dedupe key already exists", async () => {
    const db = makeDb({
      notification_messages: [{ data: ACTIVE_MESSAGE }],
      notifications: [{ data: [] }],
    });
    const push = makePush();
    const svc = new NotificationsService(db.supabase, push);

    await svc.emit({
      trigger: "tx_confirmed",
      walletAddress: "GWALLET",
      dedupeKey: "tx:abc",
    });

    expect(push.sendToWallet).not.toHaveBeenCalled();
  });

  it("does not push when the trigger has no active message", async () => {
    const db = makeDb({ notification_messages: [{ data: null }] });
    const push = makePush();
    const svc = new NotificationsService(db.supabase, push);

    await svc.emit({
      trigger: "vault_run",
      walletAddress: "GWALLET",
      dedupeKey: "vault_run:CV:2026-10-06",
    });

    expect(push.sendToWallet).not.toHaveBeenCalled();
  });
});

describe("NotificationsService.vaultDepositors", () => {
  it("returns each depositing wallet once, filtered by vault", async () => {
    const db = makeDb({
      audit_logs: [
        {
          data: [
            { wallet_address: "GA" },
            { wallet_address: "GB" },
            { wallet_address: "GA" },
            { wallet_address: null },
          ],
        },
      ],
    });
    const svc = new NotificationsService(db.supabase, makePush());

    const wallets = await svc.vaultDepositors("CVAULT");

    expect(wallets).toEqual(["GA", "GB"]);
    const eqCalls = db.calls
      .filter((c) => c.table === "audit_logs" && c.method === "eq")
      .map((c) => c.args);
    expect(eqCalls).toEqual([
      ["action_type", "vaults_deposit"],
      ["pool_id", "CVAULT"],
    ]);
  });

  it("reads every vault when no vault is given", async () => {
    const db = makeDb({ audit_logs: [{ data: [{ wallet_address: "GA" }] }] });
    const svc = new NotificationsService(db.supabase, makePush());

    await svc.vaultDepositors();

    const eqCalls = db.calls
      .filter((c) => c.table === "audit_logs" && c.method === "eq")
      .map((c) => c.args);
    expect(eqCalls).toEqual([["action_type", "vaults_deposit"]]);
  });
});
