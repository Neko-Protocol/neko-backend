export type MailingAutomationStatus =
  | "draft"
  | "active"
  | "paused"
  | "archived";

export type MailingAutomation = {
  id: string;
  name: string;
  trigger_type: string;
  trigger_params: Record<string, unknown>;
  delay_value: number;
  delay_unit: "minutes" | "hours" | "days";
  segment: string;
  template_id: string | null;
  status: MailingAutomationStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};
