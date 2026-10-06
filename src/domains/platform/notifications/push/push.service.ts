import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "@core/supabase/supabase.service";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

/**
 * Delivers push notifications to the mobile app through the Expo push service,
 * which forwards to APNs (iOS) and FCM (Android) with the credentials stored in
 * EAS.
 *
 * A wallet's devices are the Expo push tokens in `users.preferences.push_tokens`,
 * registered by the mobile app through `POST /users/preferences`.
 *
 * Depends on nothing but Supabase and config, so NotificationsCoreModule stays
 * free of module cycles. Never throws: a push failing must not break the action
 * that produced it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService
  ) {}

  /** Sends one message to every device registered for the wallet. */
  async sendToWallet(wallet: string, message: PushMessage): Promise<void> {
    try {
      const tokens = await this.tokensFor(wallet);
      if (!tokens.length) return;

      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: "default",
          }))
        ),
      });

      if (!res.ok) {
        this.logger.warn(`[push] Expo push service responded ${res.status}`);
        return;
      }

      // Tickets come back in the same order as the messages sent.
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const stale = tokens.filter((_, i) => {
        const ticket = json.data?.[i];
        return (
          ticket?.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        );
      });
      if (stale.length) await this.removeTokens(wallet, stale);
    } catch (err) {
      this.logger.warn(`[push] send failed: ${(err as Error).message}`);
    }
  }

  private async tokensFor(wallet: string): Promise<string[]> {
    const preferences = await this.preferencesFor(wallet);
    const raw = preferences.push_tokens;
    return Array.isArray(raw)
      ? raw.filter(
          (t): t is string => typeof t === "string" && EXPO_TOKEN_RE.test(t)
        )
      : [];
  }

  /** Drops tokens of devices that uninstalled the app. */
  private async removeTokens(wallet: string, stale: string[]): Promise<void> {
    const preferences = await this.preferencesFor(wallet);
    const current = Array.isArray(preferences.push_tokens)
      ? (preferences.push_tokens as unknown[])
      : [];
    await this.supabase.client
      .from("users")
      .update({
        preferences: {
          ...preferences,
          push_tokens: current.filter((t) => !stale.includes(t as string)),
        },
      })
      .eq("wallet_address", wallet);
  }

  private async preferencesFor(
    wallet: string
  ): Promise<Record<string, unknown>> {
    const { data } = await this.supabase.client
      .from("users")
      .select("preferences")
      .eq("wallet_address", wallet)
      .maybeSingle();
    return ((data as { preferences?: unknown } | null)?.preferences ??
      {}) as Record<string, unknown>;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Only needed if "Enhanced push security" is turned on in the Expo project.
    const accessToken = this.config.get<string>("EXPO_ACCESS_TOKEN");
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }
}
