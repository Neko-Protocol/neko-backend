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
  },
  {
    id: "vault_depositors",
    label: "Vault depositors",
    description: "Verified users who have deposited into a vault.",
  },
  {
    id: "admins",
    label: "Admins only",
    description: "Active entries in the admin_emails table.",
  },
  {
    id: "depositors",
    label: "Any depositors",
    description:
      "Verified users with at least one vault, lending, or pool deposit.",
  },
  {
    id: "non_depositors",
    label: "Never deposited",
    description: "Verified users who connected but never deposited.",
  },
  {
    id: "swappers_only",
    label: "Swappers (no deposit)",
    description: "Verified users who swapped but never deposited.",
  },
  {
    id: "inactive",
    label: "Inactive",
    description: "Verified users with zero recorded protocol activity.",
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
