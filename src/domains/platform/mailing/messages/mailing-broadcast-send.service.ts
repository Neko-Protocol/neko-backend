import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EmailService } from "@core/email/email.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingAudiencesService } from "../audiences/mailing-audiences.service";
import { AudienceId } from "../audiences/mailing-audiences.types";
import { MailingDispatchService } from "../dispatch/mailing-dispatch.service";
import { MailingMessagesService } from "./mailing-messages.service";
import { MailingMessage } from "./mailing-messages.types";

const ENQUEUE_CHUNK_SIZE = 500;

/**
 * Sending a broadcast enqueues its whole audience into `mailing_sends` and then
 * dispatches immediately. Going through the same queue as automations means a
 * broadcast gets per-recipient history and single-recipient retry, rather than
 * only aggregate counts.
 */
@Injectable()
export class MailingBroadcastSendService {
  private readonly logger = new Logger(MailingBroadcastSendService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly audiences: MailingAudiencesService,
    private readonly messages: MailingMessagesService,
    private readonly dispatch: MailingDispatchService
  ) {}

  async send(id: string): Promise<MailingMessage> {
    const message = await this.messages.getOrThrow(id);
    if (message.kind !== "broadcast") {
      throw new BadRequestException({ code: "NOT_A_BROADCAST" });
    }
    if (message.status !== "draft" && message.status !== "failed") {
      throw new BadRequestException({ code: "ALREADY_SENT" });
    }
    if (!this.email.isConfigured) {
      throw new BadRequestException({ code: "EMAIL_NOT_CONFIGURED" });
    }
    // Fails fast if the template was deleted out from under the broadcast.
    await this.messages.resolveContent(message);

    const recipients = await this.audiences.getSendableRecipients(
      message.audience as AudienceId
    );
    if (!recipients.length) {
      throw new BadRequestException({ code: "AUDIENCE_EMPTY" });
    }

    // Claim before enqueueing so a concurrent call can't double-send.
    const { error: claimError } = await this.supabase.client
      .from("mailing_messages")
      .update({
        status: "sending",
        recipient_count: recipients.length,
        error: null,
      })
      .eq("id", id)
      .in("status", ["draft", "failed"]);
    if (claimError) {
      throw new BadRequestException({ code: "MESSAGE_UPDATE_FAILED" });
    }

    // Retrying must not re-send to people who already received it, so a
    // broadcast's occasion is its creation time: stable across retries, which
    // keeps the (message_id, email, trigger_at) key doing the deduplication.
    const nowIso = new Date().toISOString();
    const rows = recipients.map((r) => ({
      message_id: id,
      wallet_address: r.wallet_address,
      email: r.email,
      trigger_at: message.created_at,
      scheduled_send_at: nowIso,
      status: "pending",
    }));

    for (let i = 0; i < rows.length; i += ENQUEUE_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + ENQUEUE_CHUNK_SIZE);
      const { error } = await this.supabase.client
        .from("mailing_sends")
        .upsert(chunk, {
          onConflict: "message_id,email",
          ignoreDuplicates: true,
        });
      if (error) {
        await this.markFailed(id, error.message);
        throw new BadRequestException({ code: "ENQUEUE_FAILED" });
      }
    }

    // Previously-failed recipients are returned to the queue; dispatch only
    // picks up "pending", so without this a retry would silently do nothing.
    const { error: retryError } = await this.supabase.client
      .from("mailing_sends")
      .update({ status: "pending", error: null })
      .eq("message_id", id)
      .eq("status", "failed");
    if (retryError) {
      throw new BadRequestException({ code: "ENQUEUE_FAILED" });
    }

    // Dispatch inline so the admin gets a real result instead of watching a
    // pending count until the next cron tick.
    const result = await this.dispatch.run(id);
    const stats = await this.messages.getSendStats(id);

    const status =
      stats.pending > 0 ? "sending" : stats.sent > 0 ? "sent" : "failed";
    const { error: finalError } = await this.supabase.client
      .from("mailing_messages")
      .update({
        status,
        sent_count: stats.sent,
        failed_count: stats.failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (finalError) {
      throw new BadRequestException({ code: "MESSAGE_UPDATE_FAILED" });
    }

    this.logger.log(
      `broadcast ${id}: sent=${result.sent} failed=${result.failed} pending=${stats.pending}`
    );
    return this.messages.getOrThrow(id);
  }

  private async markFailed(id: string, error: string): Promise<void> {
    await this.supabase.client
      .from("mailing_messages")
      .update({ status: "failed", error })
      .eq("id", id);
  }
}
