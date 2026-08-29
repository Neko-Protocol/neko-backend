/**
 * Audience catalog shared by one-off broadcasts and triggered automations.
 *
 * Replaces the removed `domains/admin/segments` module: the same recipient
 * resolution now lives inside the mailing domain, which was its only consumer.
 */
export const AUDIENCES = [
  {
    id: "all",
    label: "All emails",
    description: "Everyone with a verified email address.",
    /** Admin-list audiences have no wallet, so they can't drive automations. */
    automationCompatible: true,
  },
  {
    id: "vault_depositors",
    label: "Vault depositors",
    description: "Verified users who have deposited into a vault.",
    automationCompatible: true,
  },
  {
    id: "admins",
    label: "Admins only",
    description: "Active entries in the admin_emails table.",
    automationCompatible: false,
  },
  {
    id: "depositors",
    label: "Any depositors",
    description:
      "Verified users with at least one vault, lending, or pool deposit.",
    automationCompatible: true,
  },
  {
    id: "non_depositors",
    label: "Never deposited",
    description: "Verified users who connected but never deposited.",
    automationCompatible: true,
  },
  {
    id: "swappers_only",
    label: "Swappers (no deposit)",
    description: "Verified users who swapped but never deposited.",
    automationCompatible: true,
  },
  {
    id: "inactive",
    label: "Inactive",
    description: "Verified users with zero recorded protocol activity.",
    automationCompatible: true,
  },
] as const;

export type AudienceId = (typeof AUDIENCES)[number]["id"];

/** `wallet_address` is null for admin-list recipients, which have no wallet. */
export type Recipient = { email: string; wallet_address: string | null };

export function isAudienceId(value: unknown): value is AudienceId {
  return (
    typeof value === "string" &&
    (AUDIENCES as readonly { id: string }[]).some((a) => a.id === value)
  );
}

export function isAutomationAudience(id: AudienceId): boolean {
  return AUDIENCES.find((a) => a.id === id)?.automationCompatible ?? false;
}
