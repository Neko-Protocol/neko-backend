// AuditService pulls in @neko/keeper, which ships ESM that Jest can't parse.
jest.mock("@neko/keeper", () => ({
  getAssetsConfig: () => ({}),
  getContractToCodeMap: () => ({}),
  getCurrentNetworkId: () => "PUBLIC",
}));

import { SupabaseService } from "@core/supabase/supabase.service";
import { AuditService } from "@domains/platform/audit/audit.service";
import { MailingAudiencesService } from "./mailing-audiences.service";

const WALLET_DEPOSITOR = "GDEPOSITOR";
const WALLET_SWAPPER = "GSWAPPER";
const WALLET_IDLE = "GIDLE";

type UsersRow = { email: string; wallet_address: string };

/**
 * Minimal Supabase query-builder double. Each `from()` returns a thenable
 * chain whose terminal `range()`/`order()` resolves to the fixture rows for
 * that table, which is all the audience queries actually use.
 */
function makeSupabase(opts: {
  users: UsersRow[];
  admins: { email: string; is_active: boolean }[];
  optOuts?: string[];
}) {
  const client = {
    from(table: string) {
      const rowsFor = () => {
        if (table === "users") return opts.users;
        if (table === "admin_emails")
          return opts.admins.filter((a) => a.is_active);
        if (table === "mailing_opt_outs")
          return (opts.optOuts ?? []).map((w) => ({ wallet_address: w }));
        return [];
      };

      // Every builder method returns the same object; the awaited value is
      // always { data, error }, so call order doesn't matter here.
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "not", "eq", "order", "in", "range"]) {
        builder[m] = chain;
      }
      builder.then = (
        resolve: (v: { data: unknown; error: null }) => unknown
      ) => resolve({ data: rowsFor(), error: null });
      return builder;
    },
  };
  return { client } as unknown as SupabaseService;
}

function makeAudit(rows: { wallet_address: string; action_type: string }[]) {
  return {
    query: jest.fn().mockResolvedValue(rows),
  } as unknown as AuditService;
}

describe("MailingAudiencesService", () => {
  const users: UsersRow[] = [
    { email: "depositor@test.io", wallet_address: WALLET_DEPOSITOR },
    { email: "swapper@test.io", wallet_address: WALLET_SWAPPER },
    { email: "idle@test.io", wallet_address: WALLET_IDLE },
  ];

  const admins = [
    { email: "admin@neko.xyz", is_active: true },
    { email: "removed@neko.xyz", is_active: false },
  ];

  const auditRows = [
    { wallet_address: WALLET_DEPOSITOR, action_type: "vaults_deposit" },
    { wallet_address: WALLET_SWAPPER, action_type: "swap" },
  ];

  function build(optOuts?: string[]) {
    return new MailingAudiencesService(
      makeSupabase({ users, admins, optOuts }),
      makeAudit(auditRows)
    );
  }

  it("'all' returns every verified user", async () => {
    const recipients = await build().getRecipients("all");
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "depositor@test.io",
      "idle@test.io",
      "swapper@test.io",
    ]);
  });

  it("'vault_depositors' returns only wallets with a vault deposit", async () => {
    const recipients = await build().getRecipients("vault_depositors");
    expect(recipients).toEqual([
      { email: "depositor@test.io", wallet_address: WALLET_DEPOSITOR },
    ]);
  });

  it("'admins' returns active admin_emails rows and no wallet", async () => {
    const recipients = await build().getRecipients("admins");
    expect(recipients).toEqual([
      { email: "admin@neko.xyz", wallet_address: null },
    ]);
  });

  it("excludes opted-out wallets from sendable recipients", async () => {
    const recipients = await build([WALLET_SWAPPER]).getSendableRecipients(
      "all"
    );
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "depositor@test.io",
      "idle@test.io",
    ]);
  });

  it("never drops admin recipients, which have no wallet to opt out", async () => {
    const recipients = await build([WALLET_DEPOSITOR]).getSendableRecipients(
      "admins"
    );
    expect(recipients).toHaveLength(1);
  });
});
