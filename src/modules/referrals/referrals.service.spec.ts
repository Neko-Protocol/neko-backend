import { NotFoundException } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { ReferralsService } from "./referrals.service";

const WALLET = "GREFERRER";
const REFERRED = "GREFERRED";
const CODE = "ABCD2345";

type DbResult = { data?: unknown; error?: unknown };

/**
 * Builds a supabase-js stub whose chained calls all resolve through a
 * per-table queue of results, in call order.
 */
function makeDb(results: Record<string, DbResult[]>) {
  const queues = new Map<string, DbResult[]>(
    Object.entries(results).map(([k, v]) => [k, [...v]])
  );
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  const next = (table: string): DbResult => {
    const queue = queues.get(table);
    if (!queue?.length) return { data: null, error: null };
    return queue.shift()!;
  };

  const from = jest.fn((table: string) => {
    const result = () => Promise.resolve(next(table));
    const builder: Record<string, unknown> = {};
    const chain = (method: string) =>
      jest.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    builder.select = chain("select");
    builder.insert = jest.fn((...args: unknown[]) => {
      calls.push({ table, method: "insert", args });
      const pending = result();
      return {
        then: (
          resolve: (value: DbResult) => unknown,
          reject?: (reason: unknown) => unknown
        ) => pending.then(resolve, reject),
      };
    });
    builder.update = chain("update");
    builder.eq = chain("eq");
    builder.in = chain("in");
    builder.not = chain("not");
    builder.maybeSingle = jest.fn(() => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return result();
    });
    builder.then = (
      resolve: (value: DbResult) => unknown,
      reject?: (reason: unknown) => unknown
    ) => result().then(resolve, reject);
    return builder;
  });

  const rpc = jest.fn(() => Promise.resolve({ data: [], error: null }));

  const supabase = {
    get client() {
      return { from, rpc };
    },
  } as unknown as SupabaseService;

  return { supabase, from, rpc, calls };
}

describe("ReferralsService", () => {
  describe("getOrCreateCode()", () => {
    it("returns the existing code without inserting", async () => {
      const db = makeDb({
        referral_codes: [{ data: { code: CODE }, error: null }],
      });
      const svc = new ReferralsService(db.supabase);

      await expect(svc.getOrCreateCode(WALLET)).resolves.toEqual({
        code: CODE,
      });
      expect(
        db.calls.filter((c) => c.method === "insert")
      ).toHaveLength(0);
    });

    it("creates an 8-char code from the unambiguous alphabet", async () => {
      const db = makeDb({
        referral_codes: [
          { data: null, error: null }, // no existing code
          { data: null, error: null }, // insert ok
        ],
      });
      const svc = new ReferralsService(db.supabase);

      const { code } = await svc.getOrCreateCode(WALLET);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    });

    it("404s when the user row does not exist yet (FK violation)", async () => {
      const db = makeDb({
        referral_codes: [
          { data: null, error: null },
          { data: null, error: { code: "23503", message: "fk" } },
        ],
      });
      const svc = new ReferralsService(db.supabase);

      await expect(svc.getOrCreateCode(WALLET)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("attribute()", () => {
    it("inserts a pending referral for a known code", async () => {
      const db = makeDb({
        referral_codes: [{ data: { wallet_address: WALLET }, error: null }],
        referrals: [{ data: null, error: null }],
      });
      const svc = new ReferralsService(db.supabase);

      await svc.attribute({ code: ` ${CODE.toLowerCase()} `, referred_wallet: REFERRED });

      const insert = db.calls.find(
        (c) => c.table === "referrals" && c.method === "insert"
      );
      expect(insert?.args[0]).toEqual({
        code: CODE,
        referrer_wallet: WALLET,
        referred_wallet: REFERRED,
      });
    });

    it("is a silent no-op for an unknown code", async () => {
      const db = makeDb({
        referral_codes: [{ data: null, error: null }],
      });
      const svc = new ReferralsService(db.supabase);

      await expect(
        svc.attribute({ code: "NOPE1234", referred_wallet: REFERRED })
      ).resolves.toBeUndefined();
      expect(
        db.calls.filter((c) => c.table === "referrals")
      ).toHaveLength(0);
    });

    it("is a silent no-op for self-referral", async () => {
      const db = makeDb({
        referral_codes: [{ data: { wallet_address: WALLET }, error: null }],
      });
      const svc = new ReferralsService(db.supabase);

      await svc.attribute({ code: CODE, referred_wallet: WALLET });
      expect(
        db.calls.filter((c) => c.table === "referrals")
      ).toHaveLength(0);
    });

    it("never throws even when the insert fails", async () => {
      const db = makeDb({
        referral_codes: [{ data: { wallet_address: WALLET }, error: null }],
        referrals: [{ data: null, error: { code: "XX000", message: "boom" } }],
      });
      const svc = new ReferralsService(db.supabase);

      await expect(
        svc.attribute({ code: CODE, referred_wallet: REFERRED })
      ).resolves.toBeUndefined();
    });
  });
});
