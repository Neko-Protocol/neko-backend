import { Injectable } from "@nestjs/common";
import { SupabaseService } from "@core/supabase/supabase.service";

export type MailingKindStats = {
  /** Messages of this kind that have gone out at least once. */
  messages: number;
  /** Individual emails delivered. */
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
};

export type MailingStats = {
  broadcasts: MailingKindStats;
  automations: MailingKindStats;
  totalSent: number;
  optOuts: number;
  templates: number;
  activeAutomations: number;
};

type Row = Record<string, unknown>;

const PAGE_SIZE = 1000;

@Injectable()
export class MailingStatsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Send rows carry no kind of their own, so they're grouped by walking the
   * message ids for each kind. Counting in the database with head:true keeps
   * this cheap even once the sends table is large.
   */
  private async messageIdsByKind(
    kind: "broadcast" | "automation"
  ): Promise<string[]> {
    const out: string[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await this.supabase.client
        .from("mailing_messages")
        .select("id")
        .eq("kind", kind)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data?.length) break;
      for (const r of data as Row[]) {
        if (typeof r.id === "string") out.push(r.id);
      }
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return out;
  }

  private async sendCounts(
    messageIds: string[],
    status: string
  ): Promise<number> {
    if (!messageIds.length) return 0;
    let total = 0;
    for (let i = 0; i < messageIds.length; i += 200) {
      const chunk = messageIds.slice(i, i + 200);
      const { count, error } = await this.supabase.client
        .from("mailing_sends")
        .select("*", { count: "exact", head: true })
        .in("message_id", chunk)
        .eq("status", status);
      if (!error) total += count ?? 0;
    }
    return total;
  }

  private async statsFor(
    kind: "broadcast" | "automation"
  ): Promise<MailingKindStats> {
    const ids = await this.messageIdsByKind(kind);

    const [sent, failed, skipped, pending] = await Promise.all([
      this.sendCounts(ids, "sent"),
      this.sendCounts(ids, "failed"),
      this.sendCounts(ids, "skipped"),
      this.sendCounts(ids, "pending"),
    ]);

    // "Messages" counts campaigns that actually went out, not drafts.
    const { count: messages } = await this.supabase.client
      .from("mailing_messages")
      .select("*", { count: "exact", head: true })
      .eq("kind", kind)
      .not("sent_at", "is", null);

    return {
      messages: messages ?? 0,
      sent,
      failed,
      skipped,
      pending,
    };
  }

  async get(): Promise<MailingStats> {
    const [broadcasts, automations] = await Promise.all([
      this.statsFor("broadcast"),
      this.statsFor("automation"),
    ]);

    const client = this.supabase.client;
    const [optOuts, templates, activeAutomations] = await Promise.all([
      client
        .from("mailing_opt_outs")
        .select("*", { count: "exact", head: true }),
      client
        .from("mailing_templates")
        .select("*", { count: "exact", head: true }),
      client
        .from("mailing_messages")
        .select("*", { count: "exact", head: true })
        .eq("kind", "automation")
        .eq("status", "active"),
    ]);

    return {
      broadcasts,
      automations,
      totalSent: broadcasts.sent + automations.sent,
      optOuts: optOuts.count ?? 0,
      templates: templates.count ?? 0,
      activeAutomations: activeAutomations.count ?? 0,
    };
  }
}
