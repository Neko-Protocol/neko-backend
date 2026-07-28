import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "@core/email/email.service";
import { SupabaseService } from "@core/supabase/supabase.service";
import { MailingUnsubscribeTokenService } from "../unsubscribe/mailing-unsubscribe-token.service";

const BATCH_LIMIT = 200;

type Row = Record<string, unknown>;

type DueRun = {
  id: string;
  automation_id: string;
  wallet_address: string;
  email: string;
};

type AutomationRow = {
  status: string;
  template_id: string | null;
  name: string;
};

type TemplateRow = {
  subject: string;
  body_html: string;
};

@Injectable()
export class MailingDispatchService {
  private readonly logger = new Logger(MailingDispatchService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly unsubscribeTokens: MailingUnsubscribeTokenService,
    private readonly config: ConfigService
  ) {}

  private renderTemplate(
    text: string,
    vars: { wallet_address: string; email: string }
  ): string {
    return text
      .replace(/\{\{\s*wallet_address\s*\}\}/gi, vars.wallet_address)
      .replace(/\{\{\s*email\s*\}\}/gi, vars.email);
  }

  async run(): Promise<{ sent: number; skipped: number; failed: number }> {
    const client = this.supabase.client;
    const nowIso = new Date().toISOString();

    const { data: dueData, error: dueError } = await client
      .from("mailing_automation_runs")
      .select("id,automation_id,wallet_address,email")
      .eq("status", "pending")
      .lte("scheduled_send_at", nowIso)
      .order("scheduled_send_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (dueError) {
      throw new Error(dueError.message);
    }

    const dueRows = (dueData ?? []) as Row[];
    if (!dueRows.length) {
      return { sent: 0, skipped: 0, failed: 0 };
    }

    const runs: DueRun[] = [];
    for (const r of dueRows) {
      const id = typeof r.id === "string" ? r.id : null;
      const automation_id =
        typeof r.automation_id === "string" ? r.automation_id : null;
      const wallet_address =
        typeof r.wallet_address === "string" ? r.wallet_address : null;
      const email = typeof r.email === "string" ? r.email : null;
      if (!id || !automation_id || !wallet_address || !email) continue;
      runs.push({ id, automation_id, wallet_address, email });
    }

    if (!runs.length) {
      return { sent: 0, skipped: 0, failed: 0 };
    }

    const automationIds = [...new Set(runs.map((r) => r.automation_id))];
    const automationsById = new Map<string, AutomationRow>();
    if (automationIds.length) {
      const { data: automationsData, error: automationsError } = await client
        .from("mailing_automations")
        .select("id,status,template_id,name")
        .in("id", automationIds);
      if (automationsError) {
        throw new Error(automationsError.message);
      }
      for (const raw of (automationsData ?? []) as Row[]) {
        const id = typeof raw.id === "string" ? raw.id : null;
        if (!id) continue;
        automationsById.set(id, {
          status: typeof raw.status === "string" ? raw.status : "",
          template_id:
            typeof raw.template_id === "string" ? raw.template_id : null,
          name: typeof raw.name === "string" ? raw.name : "",
        });
      }
    }

    const templateIds = [
      ...new Set(
        [...automationsById.values()]
          .map((a) => a.template_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const templatesById = new Map<string, TemplateRow>();
    if (templateIds.length) {
      const { data: templatesData, error: templatesError } = await client
        .from("mailing_templates")
        .select("id,subject,body_html")
        .in("id", templateIds);
      if (templatesError) {
        throw new Error(templatesError.message);
      }
      for (const raw of (templatesData ?? []) as Row[]) {
        const id = typeof raw.id === "string" ? raw.id : null;
        if (!id) continue;
        templatesById.set(id, {
          subject: typeof raw.subject === "string" ? raw.subject : "",
          body_html: typeof raw.body_html === "string" ? raw.body_html : "",
        });
      }
    }

    const wallets = [...new Set(runs.map((r) => r.wallet_address))];
    const optedOutWallets = new Set<string>();
    if (wallets.length) {
      const { data: optOutData, error: optOutError } = await client
        .from("mailing_opt_outs")
        .select("wallet_address")
        .in("wallet_address", wallets);
      if (optOutError) {
        throw new Error(optOutError.message);
      }
      for (const raw of (optOutData ?? []) as Row[]) {
        if (typeof raw.wallet_address === "string") {
          optedOutWallets.add(raw.wallet_address);
        }
      }
    }

    const webAppUrl = (
      this.config.get<string>("WEB_APP_URL") || "https://dapp.nekoprotocol.xyz"
    ).replace(/\/+$/, "");

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let unsubscribeWarnLogged = false;

    for (const run of runs) {
      try {
        const automation = automationsById.get(run.automation_id);
        if (!automation || automation.status !== "active") {
          const { error } = await client
            .from("mailing_automation_runs")
            .update({ status: "skipped", error: "automation not active" })
            .eq("id", run.id);
          if (error) throw new Error(error.message);
          skipped += 1;
          continue;
        }

        if (optedOutWallets.has(run.wallet_address)) {
          const { error } = await client
            .from("mailing_automation_runs")
            .update({ status: "skipped", error: "recipient opted out" })
            .eq("id", run.id);
          if (error) throw new Error(error.message);
          skipped += 1;
          continue;
        }

        const template =
          automation.template_id != null
            ? templatesById.get(automation.template_id)
            : undefined;
        if (!template) {
          const { error } = await client
            .from("mailing_automation_runs")
            .update({ status: "failed", error: "template not found" })
            .eq("id", run.id);
          if (error) throw new Error(error.message);
          failed += 1;
          continue;
        }

        const vars = {
          wallet_address: run.wallet_address,
          email: run.email,
        };
        const renderedSubject = this.renderTemplate(template.subject, vars);
        let renderedHtml = this.renderTemplate(template.body_html, vars);

        try {
          if (this.unsubscribeTokens.isConfigured) {
            const token = this.unsubscribeTokens.sign(run.wallet_address);
            const unsubscribeUrl = `${webAppUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
            renderedHtml += `<p style="margin-top:24px;font-size:12px;color:#888;">If you no longer want these emails, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`;
          } else if (!unsubscribeWarnLogged) {
            this.logger.warn(
              "MAILING_UNSUBSCRIBE_SECRET not configured; sending without unsubscribe footer"
            );
            unsubscribeWarnLogged = true;
          }
        } catch (err) {
          if (!unsubscribeWarnLogged) {
            this.logger.warn(
              `unsubscribe token failed; sending without footer: ${(err as Error).message}`
            );
            unsubscribeWarnLogged = true;
          }
        }

        try {
          await this.email.sendStrict({
            to: run.email,
            subject: renderedSubject,
            html: renderedHtml,
          });
        } catch (err) {
          const message = (err as Error).message;
          this.logger.warn(
            `mailing-dispatch send failed for run ${run.id}: ${message}`
          );
          const { error } = await client
            .from("mailing_automation_runs")
            .update({ status: "failed", error: message })
            .eq("id", run.id);
          if (error) throw new Error(error.message);
          failed += 1;
          continue;
        }

        const { error: sentError } = await client
          .from("mailing_automation_runs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
          })
          .eq("id", run.id);
        if (sentError) throw new Error(sentError.message);
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `mailing-dispatch unexpected error for run ${run.id}: ${(err as Error).message}`
        );
        failed += 1;
      }
    }

    return { sent, skipped, failed };
  }
}
