/**
 * A message is anything sendable. The only structural difference between the
 * two kinds is the trigger: an automation has one and fires repeatedly as
 * people qualify; a broadcast has none and goes out once.
 */
export type MailingMessageKind = "broadcast" | "automation";

export type MailingMessageStatus =
  "draft" | "active" | "paused" | "archived" | "sending" | "sent" | "failed";

export type MailingDelayUnit = "minutes" | "hours" | "days";

export type MailingMessage = {
  id: string;
  kind: MailingMessageKind;
  name: string;
  template_id: string | null;
  subject: string | null;
  body_html: string | null;
  audience: string;
  trigger_type: string | null;
  trigger_params: Record<string, unknown>;
  delay_value: number;
  delay_unit: MailingDelayUnit;
  status: MailingMessageStatus;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  created_by: string | null;
  error: string | null;
};

export type MailingSend = {
  id: string;
  wallet_address: string | null;
  email: string;
  trigger_at: string | null;
  scheduled_send_at: string;
  status: string;
  sent_at: string | null;
  error: string | null;
};

export type MailingSendStats = {
  enrolled: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
};

export const DELAY_UNITS: readonly MailingDelayUnit[] = [
  "minutes",
  "hours",
  "days",
];

/**
 * Automations use a lifecycle; broadcasts use a send state. Archived is not
 * terminal: it returns to draft so an automation cannot silently resume.
 */
export const AUTOMATION_TRANSITIONS: Record<
  MailingMessageStatus,
  MailingMessageStatus[]
> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: ["draft"],
  sending: [],
  sent: [],
  failed: [],
};

export function isDelayUnit(value: unknown): value is MailingDelayUnit {
  return (
    typeof value === "string" &&
    (DELAY_UNITS as readonly string[]).includes(value)
  );
}

export function isMessageKind(value: unknown): value is MailingMessageKind {
  return value === "broadcast" || value === "automation";
}
