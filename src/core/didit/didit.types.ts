export type DiditSessionStatus =
  | "Not Started"
  | "In Progress"
  | "Awaiting User"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Resubmitted"
  | "Expired"
  | "Kyc Expired"
  | "Abandoned";

export interface DiditCreateSessionInput {
  workflowId: string;
  vendorData: string;
  callback?: string;
  metadata?: Record<string, string>;
}

export interface DiditSession {
  session_id: string;
  url: string;
  status: string;
  vendor_data?: string;
}

export interface DiditDecision {
  session_id: string;
  status: string;
  session_kind?: "user" | "business";
  vendor_data?: string | null;
  id_verifications?: Array<{
    status?: string;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    nationality?: string | null;
    issuing_state?: string | null;
  }> | null;
  registry_checks?: Array<{
    status?: string;
    company?: {
      company_name?: string | null;
      country_code?: string | null;
    } | null;
  }> | null;
  [key: string]: unknown;
}

export interface DiditWebhookPayload {
  event_id?: string;
  webhook_type?: string;
  session_id?: string;
  status?: string;
  vendor_data?: string | null;
  [key: string]: unknown;
}

export interface DiditIdentity {
  fullName: string | null;
  businessName: string | null;
  country: string | null;
}

export const DiditErrorCode = {
  DIDIT_UNAVAILABLE: "DIDIT_UNAVAILABLE",
} as const;
