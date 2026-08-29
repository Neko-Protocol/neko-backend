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
    id: "activation_paid",
    label: "Activation reward paid",
    description:
      "Fires when an activation participant's payout status becomes paid.",
  },
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number]["id"];

export type TriggerParams = { inactivity_days?: number };

export function isTriggerType(value: unknown): value is TriggerType {
  return (
    typeof value === "string" &&
    (TRIGGER_TYPES as readonly { id: string }[]).some((t) => t.id === value)
  );
}
