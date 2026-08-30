import { SupabaseService } from "@core/supabase/supabase.service";
import { NotificationsService } from "./notifications.service";

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
    const svc = new NotificationsService(db.supabase);

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
    const svc = new NotificationsService(db.supabase);

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
    const svc = new NotificationsService(db.supabase);

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
    const svc = new NotificationsService(db.supabase);

    await svc.emit({ trigger: "signup", walletAddress: "", dedupeKey: "x" });
    await svc.emit({ trigger: "signup", walletAddress: "G", dedupeKey: "  " });

    expect(db.calls).toHaveLength(0);
  });
});

describe("NotificationsService.markRead", () => {
  it("scopes the update to the wallet and to unread rows", async () => {
    const db = makeDb({ notifications: [{ data: [{ id: "n-1" }] }] });
    const svc = new NotificationsService(db.supabase);

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
    const svc = new NotificationsService(db.supabase);

    await expect(svc.markRead("GWALLET", [])).resolves.toEqual({ updated: 0 });
    expect(db.calls).toHaveLength(0);
  });
});
