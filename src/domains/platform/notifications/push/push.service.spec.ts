import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";
import { PushService } from "./push.service";

const VALID_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const VALID_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

function makeSupabase(preferences: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: preferences ? { preferences } : null });
  builder.update = (value: unknown) => {
    updates.push(value);
    return { eq: () => Promise.resolve({ error: null }) };
  };
  const supabase = {
    client: { from: () => builder },
  } as unknown as SupabaseService;
  return { supabase, updates };
}

function makeConfig(values: Record<string, string> = {}) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("PushService.sendToWallet", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("sends one message per valid Expo token", async () => {
    const { supabase } = makeSupabase({
      push_tokens: [VALID_A, "not-a-token", VALID_B],
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }, { status: "ok" }] }),
    });
    const push = new PushService(supabase, makeConfig());

    await push.sendToWallet("GWALLET", {
      title: "Neko",
      body: "Confirmed",
      data: { trigger: "tx_confirmed" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(JSON.parse(init.body)).toEqual([
      expect.objectContaining({
        to: VALID_A,
        title: "Neko",
        body: "Confirmed",
      }),
      expect.objectContaining({
        to: VALID_B,
        data: { trigger: "tx_confirmed" },
      }),
    ]);
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("sends the Expo access token when configured", async () => {
    const { supabase } = makeSupabase({ push_tokens: [VALID_A] });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const push = new PushService(
      supabase,
      makeConfig({ EXPO_ACCESS_TOKEN: "secret" })
    );

    await push.sendToWallet("GWALLET", { title: "t", body: "b" });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret"
    );
  });

  it("skips the request when the wallet has no tokens", async () => {
    const { supabase } = makeSupabase({ currency: "USD" });
    const push = new PushService(supabase, makeConfig());

    await push.sendToWallet("GWALLET", { title: "t", body: "b" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes tokens of uninstalled apps and keeps other preferences", async () => {
    const { supabase, updates } = makeSupabase({
      currency: "MXN",
      push_tokens: [VALID_A, VALID_B],
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            status: "error",
            message: "gone",
            details: { error: "DeviceNotRegistered" },
          },
          { status: "ok", id: "ticket-2" },
        ],
      }),
    });
    const push = new PushService(supabase, makeConfig());

    await push.sendToWallet("GWALLET", { title: "t", body: "b" });

    expect(updates).toEqual([
      { preferences: { currency: "MXN", push_tokens: [VALID_B] } },
    ]);
  });

  it("never throws when the request fails", async () => {
    const { supabase } = makeSupabase({ push_tokens: [VALID_A] });
    fetchMock.mockRejectedValue(new Error("network down"));
    const push = new PushService(supabase, makeConfig());

    await expect(
      push.sendToWallet("GWALLET", { title: "t", body: "b" })
    ).resolves.toBeUndefined();
  });
});
