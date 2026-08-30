import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import { ReferralsService } from "../referrals/referrals.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { UsersService } from "./users.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";

jest.mock("@supabase/supabase-js");

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

const WALLET = "GABCDEF1234567890";
const EMAIL = "user@example.com";

const DEFAULT_CONFIG: Record<string, string> = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  STELLAR_NETWORK: "MAINNET",
  WEB_APP_URL: "https://app.test",
};

function makeConfigService(
  overrides: Record<string, string | undefined> = {}
): ConfigService {
  const map = { ...DEFAULT_CONFIG, ...overrides };
  return {
    get: jest.fn((key: string) => map[key]),
  } as unknown as ConfigService;
}

type DbResult = { data?: unknown; error?: unknown };

function chainableFrom(handlers: {
  insert?: () => Promise<DbResult> | DbResult;
  upsert?: () => Promise<DbResult> | DbResult;
  selectMaybeSingle?: () => Promise<DbResult> | DbResult;
  updateWithIs?: () => Promise<DbResult> | DbResult;
  updateSimple?: () => Promise<DbResult> | DbResult;
}) {
  const insert = jest
    .fn()
    .mockImplementation(handlers.insert ?? (() => ({ error: null })));
  const upsert = jest
    .fn()
    .mockImplementation(handlers.upsert ?? (() => ({ error: null })));
  const maybeSingle = jest
    .fn()
    .mockImplementation(
      handlers.selectMaybeSingle ?? (() => ({ data: null, error: null }))
    );
  const selectEq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq: selectEq });

  const updateIs = jest
    .fn()
    .mockImplementation(handlers.updateWithIs ?? (() => ({ error: null })));
  const updateEqWithIs = jest.fn().mockReturnValue({ is: updateIs });
  const updateEqSimple = jest
    .fn()
    .mockImplementation(handlers.updateSimple ?? (() => ({ error: null })));
  const update = jest
    .fn()
    .mockImplementation((payload: Record<string, unknown>) => {
      if ("wallet_provider" in payload) {
        return { eq: updateEqWithIs };
      }
      return { eq: updateEqSimple };
    });

  const from = jest.fn().mockReturnValue({
    insert,
    upsert,
    update,
    select,
  });

  return {
    from,
    insert,
    upsert,
    update,
    select,
    selectEq,
    maybeSingle,
    updateEqWithIs,
    updateEqSimple,
    updateIs,
  };
}

function makeSupabaseService(
  db: ReturnType<typeof chainableFrom>
): SupabaseService {
  return {
    get client() {
      return { from: db.from };
    },
  } as unknown as SupabaseService;
}

describe("UsersService", () => {
  let signInWithOtp: jest.Mock;
  let getUser: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    signInWithOtp = jest.fn().mockResolvedValue({ error: null });
    getUser = jest.fn();
    mockCreateClient.mockReturnValue({
      auth: { signInWithOtp, getUser },
    } as never);
  });

  /** emit() is fire-and-forget from these services, so a no-op stands in for it. */
  function makeNotifications(): NotificationsService {
    return {
      emit: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
  }

  function buildService(
    configOverrides: Record<string, string | undefined> = {},
    db = chainableFrom({}),
    referrals: ReferralsService = {
      attribute: jest.fn().mockResolvedValue(undefined),
      confirmPending: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReferralsService
  ) {
    return new UsersService(
      makeSupabaseService(db),
      makeConfigService(configOverrides),
      referrals,
      makeNotifications()
    );
  }

  describe("register()", () => {
    it("happy insert resolves { ok: true } and inserts with network mainnet", async () => {
      const db = chainableFrom({
        insert: () => ({ error: null }),
      });
      const svc = buildService({}, db);

      const result = await svc.register({
        wallet_address: WALLET,
        wallet_provider: "freighter",
      });

      expect(result).toEqual({ ok: true });
      expect(db.from).toHaveBeenCalledWith("users");
      expect(db.insert).toHaveBeenCalledWith({
        wallet_address: WALLET,
        wallet_provider: "freighter",
        network: "mainnet",
      });
      expect(db.update).not.toHaveBeenCalled();
    });

    it("duplicate with provider triggers update wallet_provider branch", async () => {
      const db = chainableFrom({
        insert: () => ({ error: { code: "23505", message: "duplicate" } }),
        updateWithIs: () => ({ error: null }),
      });
      const svc = buildService({}, db);

      const result = await svc.register({
        wallet_address: WALLET,
        wallet_provider: "albedo",
      });

      expect(result).toEqual({ ok: true });
      expect(db.update).toHaveBeenCalledWith({ wallet_provider: "albedo" });
      expect(db.updateEqWithIs).toHaveBeenCalledWith("wallet_address", WALLET);
      expect(db.updateIs).toHaveBeenCalledWith("wallet_provider", null);
    });

    it("duplicate without provider triggers update updated_at branch", async () => {
      const db = chainableFrom({
        insert: () => ({ error: { code: "23505" } }),
        updateSimple: () => ({ error: null }),
      });
      const svc = buildService({}, db);

      const result = await svc.register({
        wallet_address: WALLET,
        wallet_provider: null,
      });

      expect(result).toEqual({ ok: true });
      expect(db.update).toHaveBeenCalledWith(
        expect.objectContaining({ updated_at: expect.any(String) })
      );
      expect(db.updateEqSimple).toHaveBeenCalledWith("wallet_address", WALLET);
      expect(db.updateIs).not.toHaveBeenCalled();
    });

    it("non-duplicate insert error still returns { ok: true } without update", async () => {
      const db = chainableFrom({
        insert: () => ({
          error: { code: "42501", message: "permission denied" },
        }),
      });
      const svc = buildService({}, db);

      const result = await svc.register({
        wallet_address: WALLET,
        wallet_provider: "freighter",
      });

      expect(result).toEqual({ ok: true });
      expect(db.update).not.toHaveBeenCalled();
    });

    it("empty wallet returns { ok: true } without DB call", async () => {
      const db = chainableFrom({});
      const svc = buildService({}, db);

      const result = await svc.register({
        wallet_address: "   ",
        wallet_provider: null,
      });

      expect(result).toEqual({ ok: true });
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("get()", () => {
    it("maps maybeSingle row to UserPublic with defaults", async () => {
      const row = {
        wallet_address: WALLET,
        wallet_provider: null,
        email: null,
        email_verified_at: null,
        created_at: "2024-01-01T00:00:00Z",
        preferences: null,
      };
      const db = chainableFrom({
        selectMaybeSingle: () => ({ data: row, error: null }),
      });
      const svc = buildService({}, db);

      const user = await svc.get(WALLET);

      expect(user).toEqual({
        wallet_address: WALLET,
        wallet_provider: null,
        email: null,
        email_verified_at: null,
        created_at: "2024-01-01T00:00:00Z",
        preferences: {},
      });
      expect(db.selectEq).toHaveBeenCalledWith("wallet_address", WALLET);
    });

    it("returns null when maybeSingle returns error", async () => {
      const db = chainableFrom({
        selectMaybeSingle: () => ({
          data: null,
          error: { message: "db fail" },
        }),
      });
      const svc = buildService({}, db);

      expect(await svc.get(WALLET)).toBeNull();
    });

    it("returns null when maybeSingle returns no data", async () => {
      const db = chainableFrom({
        selectMaybeSingle: () => ({ data: null, error: null }),
      });
      const svc = buildService({}, db);

      expect(await svc.get(WALLET)).toBeNull();
    });

    it("empty wallet returns null without DB call", async () => {
      const db = chainableFrom({});
      const svc = buildService({}, db);

      expect(await svc.get("  ")).toBeNull();
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("updatePreferences()", () => {
    it("merges current preferences with incoming and updates", async () => {
      const db = chainableFrom({
        selectMaybeSingle: () => ({
          data: { preferences: { currency: "USD" } },
          error: null,
        }),
        updateSimple: () => ({ error: null }),
      });
      const svc = buildService({}, db);

      const result = await svc.updatePreferences({
        wallet_address: WALLET,
        preferences: { ui_mode: "expert" },
      });

      expect(result).toEqual({ ok: true });
      expect(db.update).toHaveBeenCalledWith({
        preferences: { currency: "USD", ui_mode: "expert" },
      });
      expect(db.updateEqSimple).toHaveBeenCalledWith("wallet_address", WALLET);
    });

    it("missing wallet returns { ok: true } without update", async () => {
      const db = chainableFrom({});
      const svc = buildService({}, db);

      const result = await svc.updatePreferences({
        wallet_address: "  ",
        preferences: { currency: "USD" },
      });

      expect(result).toEqual({ ok: true });
      expect(db.from).not.toHaveBeenCalled();
    });

    it("missing preferences returns { ok: true } without update", async () => {
      const db = chainableFrom({});
      const svc = buildService({}, db);

      const result = await svc.updatePreferences({
        wallet_address: WALLET,
        preferences: undefined as never,
      });

      expect(result).toEqual({ ok: true });
      expect(db.from).not.toHaveBeenCalled();
    });
  });

  describe("startEmailVerification()", () => {
    const validDto = { wallet_address: WALLET, email: EMAIL };

    it("throws BadRequestException when wallet is missing", async () => {
      const svc = buildService();
      await expect(
        svc.startEmailVerification({ wallet_address: "  ", email: EMAIL })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when email is invalid", async () => {
      const svc = buildService();
      await expect(
        svc.startEmailVerification({
          wallet_address: WALLET,
          email: "not-an-email",
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws InternalServerErrorException when anon client is not configured", async () => {
      const svc = buildService({ SUPABASE_ANON_KEY: undefined });
      await expect(svc.startEmailVerification(validDto)).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("throws InternalServerErrorException when WEB_APP_URL is missing", async () => {
      const svc = buildService({ WEB_APP_URL: undefined });
      await expect(svc.startEmailVerification(validDto)).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });

    it("throws InternalServerErrorException on upsert error", async () => {
      const db = chainableFrom({
        upsert: () => ({ error: { message: "upsert failed" } }),
      });
      const svc = buildService({}, db);

      await expect(svc.startEmailVerification(validDto)).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
      expect(signInWithOtp).not.toHaveBeenCalled();
    });

    it("throws InternalServerErrorException on signInWithOtp error", async () => {
      const db = chainableFrom({ upsert: () => ({ error: null }) });
      signInWithOtp.mockResolvedValue({ error: { message: "otp failed" } });
      const svc = buildService({}, db);

      await expect(svc.startEmailVerification(validDto)).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });

    it("happy path resolves { ok: true } and sends OTP with email redirect", async () => {
      const db = chainableFrom({ upsert: () => ({ error: null }) });
      const svc = buildService({}, db);

      const result = await svc.startEmailVerification(validDto);

      expect(result).toEqual({ ok: true });
      expect(db.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_address: WALLET,
          network: "mainnet",
          email: EMAIL,
          email_verified_at: null,
        }),
        { onConflict: "wallet_address" }
      );
      expect(signInWithOtp).toHaveBeenCalledWith({
        email: EMAIL,
        options: expect.objectContaining({
          shouldCreateUser: true,
          emailRedirectTo: `https://app.test/auth/email-confirmed?wallet=${encodeURIComponent(WALLET)}`,
          data: { wallet_address: WALLET },
        }),
      });
    });
  });

  describe("confirmEmail()", () => {
    const token = "access-token-xyz";
    const validDto = { wallet: WALLET, access_token: token };

    it("throws BadRequestException when params are missing", async () => {
      const svc = buildService();
      await expect(
        svc.confirmEmail({ wallet: "  ", access_token: token })
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.confirmEmail({ wallet: WALLET, access_token: "  " })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws UnauthorizedException when getUser returns error", async () => {
      getUser.mockResolvedValue({
        data: null,
        error: { message: "bad token" },
      });
      const svc = buildService();

      await expect(svc.confirmEmail(validDto)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });

    it("throws UnauthorizedException when getUser returns no email", async () => {
      getUser.mockResolvedValue({
        data: { user: { id: "auth-1", email: undefined } },
        error: null,
      });
      const svc = buildService();

      await expect(svc.confirmEmail(validDto)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });

    it("throws InternalServerErrorException on update error", async () => {
      getUser.mockResolvedValue({
        data: { user: { id: "auth-1", email: EMAIL } },
        error: null,
      });
      const db = chainableFrom({
        updateSimple: () => ({ error: { message: "update failed" } }),
      });
      const svc = buildService({}, db);

      await expect(svc.confirmEmail(validDto)).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });

    it("happy path resolves { ok: true } and updates verified fields", async () => {
      getUser.mockResolvedValue({
        data: { user: { id: "auth-user-42", email: EMAIL } },
        error: null,
      });
      const db = chainableFrom({
        updateSimple: () => ({ error: null }),
      });
      const svc = buildService({}, db);

      const result = await svc.confirmEmail(validDto);

      expect(result).toEqual({ ok: true });
      expect(getUser).toHaveBeenCalledWith(token);
      expect(db.update).toHaveBeenCalledWith({
        email: EMAIL,
        email_verified_at: expect.any(String),
        auth_user_id: "auth-user-42",
      });
      expect(db.updateEqSimple).toHaveBeenCalledWith("wallet_address", WALLET);
    });
  });
});
