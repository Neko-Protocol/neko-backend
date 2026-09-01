import type {
  Notification,
  NotificationCategory,
  NotificationMessage,
  NotificationMessageKind,
  NotificationMessageStatus,
  NotificationTriggerId,
} from "@neko/api-contracts";

export type {
  Notification,
  NotificationCategory,
  NotificationMessage,
  NotificationMessageKind,
  NotificationMessageStatus,
  NotificationTriggerId,
};

/**
 * The in-app half of the trigger catalog. Ids match the mailing triggers one
 * for one, because a single event drives both channels; the admin console
 * pairs them per trigger.
 */
/**
 * The in-app half of the trigger catalog. Ids match the mailing triggers one
 * for one, because a single event drives both channels; the admin console
 * pairs them per trigger.
 *
 * The two channels deliberately differ in CADENCE for `swap_completed` and
 * `first_deposit`: in-app fires on every occurrence, email only on the first.
 * A tray item per swap is useful; an inbox item per swap is spam. The ids keep
 * the mailing wording because renaming a live enum across two tables' check
 * constraints would be churn for a cosmetic gain.
 */
export const NOTIFICATION_TRIGGERS = [
  {
    id: "signup",
    label: "Signup / wallet connect",
    description: "Fires the first time a wallet registers.",
    inAppSupported: true,
    placeholders: [] as string[],
  },
  {
    id: "first_deposit",
    label: "Deposit",
    description:
      "In-app: fires on every vault, lending, or pool deposit. Email: first deposit only.",
    inAppSupported: true,
    placeholders: ["amount", "asset", "destination"],
  },
  {
    id: "swap_completed",
    label: "Swap",
    description: "In-app: fires on every swap. Email: first swap only.",
    inAppSupported: true,
    placeholders: ["amount_in", "asset_in", "amount_out", "asset_out"],
  },
  {
    id: "inactivity",
    label: "Inactivity",
    description:
      "Fires when a wallet has had no activity for the configured number of days.",
    inAppSupported: true,
    placeholders: ["days"],
  },
  {
    id: "referral_confirmed",
    label: "Referral confirmed",
    description:
      "Fires every time a referral this wallet made becomes confirmed.",
    inAppSupported: true,
    placeholders: [] as string[],
  },
  {
    id: "admin_wallet_low_balance",
    label: "Admin wallet low on XLM",
    description:
      "Email only, to every active admin. An operational alert belongs in an inbox that is watched, not in a tray a wallet holder may never open.",
    inAppSupported: false,
    placeholders: ["balance", "threshold"],
  },
] as const;

/** Triggers that can carry an in-app message. */
export const IN_APP_TRIGGER_IDS = NOTIFICATION_TRIGGERS.filter(
  (t) => t.inAppSupported
).map((t) => t.id) as readonly string[];

export function supportsInApp(triggerId: string): boolean {
  return IN_APP_TRIGGER_IDS.includes(triggerId);
}

export function isNotificationTriggerId(
  value: unknown
): value is NotificationTriggerId {
  return (
    typeof value === "string" &&
    (NOTIFICATION_TRIGGERS as readonly { id: string }[]).some(
      (t) => t.id === value
    )
  );
}

export const NOTIFICATION_CATEGORY_VALUES: readonly NotificationCategory[] = [
  "activity",
  "reward",
  "system",
  "alert",
];

/** A single in-band emission. Deduped per wallet by `dedupeKey`. */
export interface EmitNotificationInput {
  trigger: NotificationTriggerId;
  walletAddress: string;
  /**
   * Idempotency key scoped to the wallet, e.g. `signup`, `first_swap`,
   * `referral:<id>`, or a UTC-day bucket for recurring alerts.
   */
  dedupeKey: string;
  /** Substituted into the message title and body as `{{name}}`. */
  params?: Record<string, string | number>;
}
