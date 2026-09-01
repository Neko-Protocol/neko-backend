import { BadRequestException } from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";
import { ReferralPartnersService } from "./referral-partners.service";
import { CreateReferralPartnerDto } from "./dto/create-referral-partner.dto";

const PARTNER_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Acme Inc",
  type: "company",
  code: "ACME10",
  email: "partner@acme.com",
  notes: null,
  created_by: "admin@nekoprotocol.xyz",
  created_at: "2026-01-01T00:00:00.000Z",
};

type DbResult = { data?: unknown; error?: unknown };

function makeDb(results: Record<string, DbResult[]>) {
  const queues = new Map<string, DbResult[]>(
    Object.entries(results).map(([k, v]) => [k, [...v]])
  );
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  const from = jest.fn((table: string) => {
    const result = () => Promise.resolve(next(table));
    const builder: Record<string, unknown> = {};
    const chain = (method: string) =>
      jest.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });

    function next(t: string): DbResult {
      const queue = queues.get(t);
      if (!queue?.length) return { data: null, error: null };
      return queue.shift()!;
    }

    builder.select = chain("select");
    builder.insert = jest.fn((...args: unknown[]) => {
      calls.push({ table, method: "insert", args });
      return builder;
    });
    builder.update = chain("update");
    builder.delete = chain("delete");
    builder.eq = chain("eq");
    builder.order = chain("order");
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

  const supabase = {
    get client() {
      return { from };
    },
  } as unknown as SupabaseService;

  return { supabase, from, calls };
}

const BASE_DTO: CreateReferralPartnerDto = {
  name: "Acme Inc",
  type: "company",
  code: "acme10",
  email: "partner@acme.com",
};

describe("ReferralPartnersService", () => {
  describe("list()", () => {
    it("returns mapped rows", async () => {
      const db = makeDb({
        referral_partners: [{ data: [PARTNER_ROW], error: null }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.list()).resolves.toEqual([
        {
          id: PARTNER_ROW.id,
          name: PARTNER_ROW.name,
          type: "company",
          code: PARTNER_ROW.code,
          email: PARTNER_ROW.email,
          notes: null,
          created_by: PARTNER_ROW.created_by,
          created_at: PARTNER_ROW.created_at,
        },
      ]);
    });

    it("returns an empty list on error", async () => {
      const db = makeDb({
        referral_partners: [{ data: null, error: { message: "db down" } }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.list()).resolves.toEqual([]);
    });
  });

  describe("create()", () => {
    it("uppercases the code, normalizes email, and inserts", async () => {
      const db = makeDb({
        referral_partners: [
          { data: null, error: null }, // codeIsTaken check (own table)
          { data: PARTNER_ROW, error: null }, // insert().select().maybeSingle()
        ],
        referral_codes: [{ data: null, error: null }], // codeIsTaken check (wallet codes)
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.create(BASE_DTO)).resolves.toEqual({
        id: PARTNER_ROW.id,
        name: PARTNER_ROW.name,
        type: "company",
        code: PARTNER_ROW.code,
        email: PARTNER_ROW.email,
        notes: null,
        created_by: PARTNER_ROW.created_by,
        created_at: PARTNER_ROW.created_at,
      });

      const insert = db.calls.find(
        (c) => c.table === "referral_partners" && c.method === "insert"
      );
      expect(insert?.args[0]).toMatchObject({
        code: "ACME10",
        type: "company",
      });
    });

    it("rejects a code already used by a partner", async () => {
      const db = makeDb({
        referral_partners: [{ data: { id: "other" }, error: null }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.create(BASE_DTO)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a code already used by a wallet's self-served code", async () => {
      const db = makeDb({
        referral_partners: [{ data: null, error: null }],
        referral_codes: [{ data: { code: "ACME10" }, error: null }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.create(BASE_DTO)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });

  describe("remove()", () => {
    it("deletes the row", async () => {
      const db = makeDb({
        referral_partners: [{ data: null, error: null }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.remove(PARTNER_ROW.id)).resolves.toBeUndefined();

      const del = db.calls.find(
        (c) => c.table === "referral_partners" && c.method === "delete"
      );
      expect(del).toBeDefined();
      const eq = db.calls.find(
        (c) => c.table === "referral_partners" && c.method === "eq"
      );
      expect(eq?.args).toEqual(["id", PARTNER_ROW.id]);
    });

    it("throws when the delete fails", async () => {
      const db = makeDb({
        referral_partners: [{ data: null, error: { message: "db down" } }],
      });
      const svc = new ReferralPartnersService(db.supabase);

      await expect(svc.remove(PARTNER_ROW.id)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });
  });
});
