export type CampaignStatus = "draft" | "sending" | "sent" | "failed";

export type Campaign = {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  segment: string;
  status: CampaignStatus;
  recipient_count: number | null;
  sent_at: string | null;
  created_at: string;
  created_by: string | null;
  tvl_moved: number | null;
};
