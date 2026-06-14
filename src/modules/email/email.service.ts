import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

const BATCH_CHUNK_SIZE = 50;

/**
 * Thin wrapper around Resend shared by the invitations and campaigns modules.
 * When RESEND_API_KEY is unset, sends are no-ops (best-effort transactional
 * email must never block the surrounding flow).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>("RESEND_API_KEY");
    this.client = key ? new Resend(key) : null;
    this.from =
      this.config.get<string>("RESEND_FROM_EMAIL") ?? "neko@nekoprotocol.xyz";
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Best-effort single send. Swallows errors (caller flow must not fail). */
  async send(message: EmailMessage): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.emails.send({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      });
    } catch (err) {
      this.logger.warn(`email send failed: ${String(err)}`);
    }
  }

  /**
   * Chunked batch send used for campaigns. Throws on the first batch error so
   * the campaign can be marked "failed".
   */
  async sendBatch(messages: EmailMessage[]): Promise<void> {
    if (!this.client) {
      throw new Error("RESEND_API_KEY not configured");
    }
    for (let i = 0; i < messages.length; i += BATCH_CHUNK_SIZE) {
      const chunk = messages.slice(i, i + BATCH_CHUNK_SIZE);
      const { error } = await this.client.batch.send(
        chunk.map((m) => ({
          from: this.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
        }))
      );
      if (error) throw new Error(error.message ?? "Resend batch error");
    }
  }
}
