import { SupabaseService } from "@core/supabase/supabase.service";
import { SegmentsService } from "./segments.service";

type Row = Record<string, unknown>;

function makeSupabase(users: Row[], audits: Row[]): SupabaseService {
  const served = { users: false, audit_logs: false };
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const passthrough = () => builder;
      builder.select = passthrough;
      builder.eq = passthrough;
      builder.not = passthrough;
      builder.order = passthrough;
      builder.range = () => {
        if (table === "users") {
          const data = served.users ? [] : users;
          served.users = true;
          return Promise.resolve({ data, error: null });
        }
        const data = served.audit_logs ? [] : audits;
        served.audit_logs = true;
        return Promise.resolve({ data, error: null });
      };
      return builder;
    },
  };
  return { client } as unknown as SupabaseService;
}

const USERS: Row[] = [
  { email: "dep@x.com", wallet_address: "GDEP", email_verified_at: "t" },
  { email: "swap@x.com", wallet_address: "GSWAP", email_verified_at: "t" },
  { email: "idle@x.com", wallet_address: "GIDLE", email_verified_at: "t" },
];

const AUDITS: Row[] = [
  { wallet_address: "GDEP", action_type: "vaults_deposit" },
  { wallet_address: "GSWAP", action_type: "swap" },
];

describe("SegmentsService", () => {
  const svc = () => new SegmentsService(makeSupabase(USERS, AUDITS));

  it("returns all verified users for 'all'", async () => {
    expect(await svc().getSegmentCount("all")).toBe(3);
  });

  it("returns only depositors for 'depositors'", async () => {
    const r = await svc().getSegmentRecipients("depositors");
    expect(r.map((x) => x.wallet_address)).toEqual(["GDEP"]);
  });

  it("excludes depositors for 'non_depositors'", async () => {
    const r = await svc().getSegmentRecipients("non_depositors");
    expect(r.map((x) => x.wallet_address).sort()).toEqual(["GIDLE", "GSWAP"]);
  });

  it("returns swappers that never deposited for 'swappers_only'", async () => {
    const r = await svc().getSegmentRecipients("swappers_only");
    expect(r.map((x) => x.wallet_address)).toEqual(["GSWAP"]);
  });

  it("returns users with no activity for 'inactive'", async () => {
    const r = await svc().getSegmentRecipients("inactive");
    expect(r.map((x) => x.wallet_address)).toEqual(["GIDLE"]);
  });
});
