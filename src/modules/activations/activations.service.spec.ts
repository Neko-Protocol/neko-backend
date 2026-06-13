import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StellarRpcService } from "../stellar/stellar-rpc.service";
import { SupabaseService } from "../supabase/supabase.service";
import { ActivationsService } from "./activations.service";

const ACTIVATION_ID = "11111111-1111-4111-8111-111111111111";
const PARTICIPANT_ID = "22222222-2222-4222-8222-222222222222";

type DbResult = { data?: unknown; error?: unknown };

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
    const builder: Record<string, unknown> = {};
    const chainMethods = [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "lt",
      "in",
      "not",
      "order",
      "limit",
    ];
    for (const method of chainMethods) {
      builder[method] = jest.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      });
    }
    const terminal = () => Promise.resolve(next(table));
    builder.single = jest.fn(terminal);
    builder.maybeSingle = jest.fn(terminal);
    builder.then = (
      resolve: (value: DbResult) => unknown,
      reject?: (reason: unknown) => unknown
    ) => terminal().then(resolve, reject);
    return builder;
  });

  const rpc = jest.fn(() => Promise.resolve({ data: 0, error: null }));

  const supabase = {
    get client() {
      return { from, rpc };
    },
  } as unknown as SupabaseService;

  return { supabase, from, rpc, calls };
}

function makeConfig(): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === "STELLAR_NETWORK" ? "TESTNET" : undefined
    ),
  } as unknown as ConfigService;
}

function makeStellar(): StellarRpcService {
  return {
    getNetworkPassphrase: () => "Test SDF Network ; September 2015",
    horizon: {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
    },
  } as unknown as StellarRpcService;
}

function buildService(db: ReturnType<typeof makeDb>) {
  return new ActivationsService(db.supabase, makeStellar(), makeConfig());
}

describe("ActivationsService", () => {
  describe("create()", () => {
    it("lowercases, trims and dedupes emails before inserting participants", async () => {
      const db = makeDb({
        activations: [
          { data: { id: ACTIVATION_ID, name: "Bootcamp" }, error: null },
        ],
        activation_participants: [{ data: null, error: null }],
      });
      const svc = buildService(db);

      const result = await svc.create({
        name: "Bootcamp",
        reward_xlm: 5,
        expires_at: "2026-12-31T00:00:00.000Z",
        emails: ["  Alice@Example.com ", "alice@example.com", "bob@x.io"],
      });

      expect(result.email_count).toBe(2);
      const participantInsert = db.calls.find(
        (c) => c.table === "activation_participants" && c.method === "insert"
      );
      expect(participantInsert?.args[0]).toEqual([
        { activation_id: ACTIVATION_ID, email: "alice@example.com" },
        { activation_id: ACTIVATION_ID, email: "bob@x.io" },
      ]);
    });

    it("rolls back the activation when participant insert fails", async () => {
      const db = makeDb({
        activations: [
          { data: { id: ACTIVATION_ID }, error: null },
          { data: null, error: null },
        ],
        activation_participants: [{ data: null, error: { message: "boom" } }],
      });
      const svc = buildService(db);

      await expect(
        svc.create({
          name: "X",
          reward_xlm: 1,
          expires_at: "2026-12-31T00:00:00.000Z",
          emails: ["a@b.co"],
        })
      ).rejects.toThrow();

      expect(
        db.calls.some((c) => c.table === "activations" && c.method === "delete")
      ).toBe(true);
    });
  });

  describe("list()", () => {
    it("reconciles then aggregates participant counts per activation", async () => {
      const db = makeDb({
        activations: [
          {
            data: [
              {
                id: ACTIVATION_ID,
                name: "Bootcamp",
                reward_xlm: "5",
                expires_at: "2026-12-31T00:00:00.000Z",
                created_by: null,
                created_at: "2026-06-01T00:00:00.000Z",
              },
            ],
            error: null,
          },
        ],
        activation_participants: [
          {
            data: [
              { activation_id: ACTIVATION_ID, status: "pending" },
              { activation_id: ACTIVATION_ID, status: "payable" },
              { activation_id: ACTIVATION_ID, status: "paying" },
              { activation_id: ACTIVATION_ID, status: "paid" },
            ],
            error: null,
          },
        ],
      });
      const svc = buildService(db);

      const list = await svc.list();

      expect(db.rpc).toHaveBeenCalledWith("activation_reconcile", {
        p_activation_id: null,
      });
      expect(list).toHaveLength(1);
      expect(list[0].reward_xlm).toBe(5);
      expect(list[0].counts).toEqual({
        total: 4,
        pending: 1,
        payable: 2,
        paid: 1,
      });
    });
  });

  describe("getById()", () => {
    it("404s for an unknown activation", async () => {
      const db = makeDb({
        activations: [{ data: null, error: null }],
        activation_participants: [{ data: [], error: null }],
      });
      const svc = buildService(db);

      await expect(svc.getById(ACTIVATION_ID)).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("submitPayout()", () => {
    it("409s when the participant is not in 'paying' state", async () => {
      const db = makeDb({
        activation_participants: [
          {
            data: {
              id: PARTICIPANT_ID,
              activation_id: ACTIVATION_ID,
              status: "paid",
              matched_wallet: "GDEST",
            },
            error: null,
          },
        ],
      });
      const svc = buildService(db);

      await expect(
        svc.submitPayout({
          participant_id: PARTICIPANT_ID,
          signed_xdr: "AAAA",
        })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("cancelPayout()", () => {
    it("conditionally reverts paying -> payable", async () => {
      const db = makeDb({
        activation_participants: [{ data: null, error: null }],
      });
      const svc = buildService(db);

      await expect(svc.cancelPayout(PARTICIPANT_ID)).resolves.toEqual({
        ok: true,
      });

      const update = db.calls.find(
        (c) => c.table === "activation_participants" && c.method === "update"
      );
      expect(update?.args[0]).toEqual({
        status: "payable",
        payout_started_at: null,
      });
      const eqs = db.calls.filter(
        (c) => c.table === "activation_participants" && c.method === "eq"
      );
      expect(eqs.map((c) => c.args)).toEqual(
        expect.arrayContaining([
          ["id", PARTICIPANT_ID],
          ["status", "paying"],
        ])
      );
    });
  });
});
