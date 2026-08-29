export type MailingBroadcastStatus = "draft" | "sending" | "sent" | "failed";

export type MailingBroadcast = {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  audience: string;
  status: MailingBroadcastStatus;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  created_by: string | null;
  error: string | null;
};
