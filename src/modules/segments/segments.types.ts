export const SEGMENTS = [
  {
    id: "all",
    label: "All verified users",
    description: "Everyone with a verified email",
  },
  {
    id: "depositors",
    label: "Depositors",
    description:
      "Users who have made at least one deposit (vault, lending, or pool)",
  },
  {
    id: "non_depositors",
    label: "Never deposited",
    description: "Verified users who connected but never deposited",
  },
  {
    id: "swappers_only",
    label: "Swappers (no deposit)",
    description: "Users who swapped but never deposited",
  },
  {
    id: "inactive",
    label: "Inactive",
    description: "Verified users with zero protocol activity",
  },
] as const;

export type SegmentId = (typeof SEGMENTS)[number]["id"];

export type Recipient = { email: string; wallet_address: string };

export function isSegmentId(value: unknown): value is SegmentId {
  return (
    typeof value === "string" &&
    (SEGMENTS as readonly { id: string }[]).some((s) => s.id === value)
  );
}
