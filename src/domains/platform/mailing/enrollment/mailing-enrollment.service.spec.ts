jest.mock("@neko-protocol/keeper", () => ({
  getAssetsConfig: () => ({}),
  getContractToCodeMap: () => ({}),
  getCurrentNetworkId: () => "PUBLIC",
}));

import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import { AdminWalletBalanceService } from "../triggers/admin-wallet-balance.service";
import { MAILING_SENDS_CONFLICT_TARGET } from "../mailing-sends.constants";
import { MailingEnrollmentService } from "./mailing-enrollment.service";

const WALLET = "GDEPOSITOR";
const AUTOMATION_ID = "11111111-1111-1111-1111-111111111111";
const DEPOSITED_AT = "2026-09-14T10:00:00.000Z";

/**
 * The unique key on public.mailing_sends, as the migrations declare it:
 * neko-web supabase/migrations/0017_mailing_recurring_alerts.sql adds
 * mailing_sends_message_id_email_trigger_at_key. The migrations moved to the
 * neko-web repo, so this suite can no longer read them from disk.
 */
const DECLARED_UNIQUE_KEY = "message_id,email,trigger_at";

type UpsertCall = { rows: Record<string, unknown>[]; onConflict: string };

function makeSupabase(constraint: string, calls: UpsertCall[]) {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of [
        "select",
        "not",
        "eq",
        "order",
        "in",
        "range",
        "limit",
      ]) {
        builder[m] = chain;
      }

      builder.upsert = (
        rows: Record<string, unknown>[],
        opts: { onConflict: string }
      ) => {
        calls.push({ rows, onConflict: opts.onConflict });
        const error =
          opts.onConflict === constraint
            ? null
            : {
                code: "42P10",
                message:
                  "there is no unique or exclusion constraint matching the ON CONFLICT specification",
              };
        return Promise.resolve({ data: null, error });
      };

      builder.then = (
        resolve: (v: { data: unknown; error: null }) => unknown
      ) => {
        if (table === "mailing_messages") {
          return resolve({
            data: [
              {
                id: AUTOMATION_ID,
                trigger_type: "first_deposit",
                trigger_params: {},
                delay_value: 0,
                delay_unit: "minutes",
                audience: "all",
                status: "active",
              },
            ],
            error: null,
          });
        }
        if (table === "users") {
          return resolve({
            data: [
              {
                email: "depositor@test.io",
                wallet_address: WALLET,
                email_verified_at: "2026-09-01T00:00:00.000Z",
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      };

      return builder;
    },
  };
  return { client } as unknown as SupabaseService;
}

function makeConfig(floor?: string) {
  return {
    get: (key: string) =>
      key === "MAILING_ENROLLMENT_FLOOR" ? floor : undefined,
  } as unknown as ConfigService;
}

function build(calls: UpsertCall[], constraint: string, floor?: string) {
  const audit = {
    query: jest.fn().mockResolvedValue([
      {
        wallet_address: WALLET,
        action_type: "vaults_deposit",
        created_at: DEPOSITED_AT,
      },
    ]),
  } as unknown as AuditService;

  return new MailingEnrollmentService(
    makeSupabase(constraint, calls),
    audit,
    {} as unknown as MailingAudiencesService,
    {} as unknown as AdminWalletBalanceService,
    makeConfig(floor)
  );
}

describe("MailingEnrollmentService", () => {
  const constraint = DECLARED_UNIQUE_KEY;

  it("targets the unique key the migrations actually declare", () => {
    expect(MAILING_SENDS_CONFLICT_TARGET).toBe(constraint);
  });

  it("enqueues a verified depositor instead of failing on ON CONFLICT", async () => {
    const calls: UpsertCall[] = [];
    const result = await build(calls, constraint).run();

    expect(result).toEqual({ automationsProcessed: 1, enrolled: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].onConflict).toBe(constraint);
    expect(calls[0].rows[0]).toMatchObject({
      message_id: AUTOMATION_ID,
      wallet_address: WALLET,
      email: "depositor@test.io",
      trigger_at: DEPOSITED_AT,
      scheduled_send_at: DEPOSITED_AT,
      status: "pending",
    });
  });

  it("skips a candidate whose event predates the enrollment floor", async () => {
    const calls: UpsertCall[] = [];
    // The deposit is 2026-09-14; the floor is the day after.
    const result = await build(
      calls,
      constraint,
      "2026-09-15T00:00:00.000Z"
    ).run();

    expect(result).toEqual({ automationsProcessed: 1, enrolled: 0 });
    expect(calls).toHaveLength(0);
  });

  it("enrolls a candidate whose event is at or after the floor", async () => {
    const calls: UpsertCall[] = [];
    const result = await build(
      calls,
      constraint,
      "2026-09-01T00:00:00.000Z"
    ).run();

    expect(result).toEqual({ automationsProcessed: 1, enrolled: 1 });
    expect(calls[0].rows[0]).toMatchObject({ trigger_at: DEPOSITED_AT });
  });

  it("refuses to start on an unparseable floor rather than enroll all history", () => {
    expect(() => build([], constraint, "not-a-date")).toThrow(
      /MAILING_ENROLLMENT_FLOOR/
    );
  });

  it("writes nothing when the conflict target is stale", async () => {
    const calls: UpsertCall[] = [];
    const result = await build(
      calls,
      "message_id,email,trigger_at,network"
    ).run();

    expect(result).toEqual({ automationsProcessed: 0, enrolled: 0 });
  });
});
