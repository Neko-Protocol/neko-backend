export const TRIGGER_TYPES = [
  {
    id: "signup",
    label: "Signup / wallet connect",
    description: "Fires when a wallet first connects (users.created_at).",
  },
  {
    id: "first_deposit",
    label: "First deposit",
    description: "Fires on a wallet's first vault, lending, or pool deposit.",
  },
  {
    id: "swap_completed",
    label: "Swap completed",
    description: "Fires when a wallet completes a swap.",
  },
  {
    id: "inactivity",
    label: "Inactivity",
    description:
      "Fires when a wallet has had no activity for a configurable number of days (trigger_params.inactivity_days).",
  },
  {
    id: "referral_confirmed",
    label: "Referral confirmed",
    description:
      "Fires when a referred wallet's referral status becomes confirmed.",
  },
  {
    id: "admin_wallet_low_balance",
    label: "Admin wallet low on XLM",
    description:
      "Fires while the Neko admin wallet's XLM balance is under the threshold (trigger_params.threshold_xlm). Sends at most one reminder per admin per day until it is topped up.",
  },
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number]["id"];

export type TriggerParams = {
  inactivity_days?: number;
  threshold_xlm?: number;
};

export function isTriggerType(value: unknown): value is TriggerType {
  return (
    typeof value === "string" &&
    (TRIGGER_TYPES as readonly { id: string }[]).some((t) => t.id === value)
  );
}
