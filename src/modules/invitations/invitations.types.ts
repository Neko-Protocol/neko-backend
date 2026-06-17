export const INVITATION_TYPES = [
  { id: "user", label: "User", color: "#229EDF" },
  { id: "beta", label: "Beta Tester", color: "#A78BFA" },
  { id: "vip", label: "VIP", color: "#F59E0B" },
  { id: "partner", label: "Partner", color: "#4ADE80" },
  { id: "press", label: "Press / Media", color: "#F472B6" },
] as const;

export type InvitationType = (typeof INVITATION_TYPES)[number]["id"];

export type InvitationStatus = "pending" | "accepted" | "expired";

export type Invitation = {
  id: string;
  email: string;
  type: InvitationType;
  token: string;
  status: InvitationStatus;
  assigned_to: string | null;
  notes: string | null;
  created_by: string | null;
  strategy_id: string | null;
  accepted_at: string | null;
  accepted_notes: string | null;
  volume_moved: number | null;
  expires_at: string;
  created_at: string;
};

const TYPE_SET = new Set<string>(INVITATION_TYPES.map((t) => t.id));

export function isInvitationType(x: string): x is InvitationType {
  return TYPE_SET.has(x);
}

export interface InvitationFilters {
  status?: string;
  type?: string;
  assigned_to?: string;
  strategy_id?: string;
}
