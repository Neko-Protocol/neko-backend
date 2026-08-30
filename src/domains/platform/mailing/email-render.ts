/**
 * Mailing templates are complete HTML documents stored in `mailing_templates`.
 * Sending one substitutes its variables — it does not wrap or re-brand it, so
 * what an admin previews is what the recipient receives.
 */

/** Current brand line. Templates carry this in their own header and footer. */
export const NEKO_TAGLINE = "Capital Routing Layer for RWAs";

/** The line it replaced. Kept so the data migration and its test agree. */
export const LEGACY_TAGLINE = "Plan your positions. Execute when ready.";

/**
 * Templates may place the unsubscribe control themselves with this token. When
 * a template doesn't use it, the button is appended so no send goes out without
 * an opt-out path.
 */
const UNSUBSCRIBE_TOKEN = /\{\{\s*unsubscribe_url\s*\}\}/gi;

const UNSUBSCRIBE_BUTTON_STYLE =
  "display: inline-block; background-color: rgba(255, 255, 255, 0.06); " +
  "border: 1px solid rgba(255, 255, 255, 0.12); color: #9ca3af; " +
  "text-decoration: none; font-size: 12px; font-weight: 500; " +
  "padding: 9px 20px; border-radius: 50px;";

export interface RenderEmailOptions {
  /** The template's full HTML document. */
  bodyHtml: string;
  email: string;
  walletAddress?: string | null;
  /** Null when the recipient has no wallet, or signing isn't configured. */
  unsubscribeUrl?: string | null;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unsubscribeButton(url: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding: 16px 40px 24px 40px;"><a href="${escapeAttribute(url)}" style="${UNSUBSCRIBE_BUTTON_STYLE}">Unsubscribe</a></td></tr></table>`;
}

export function renderEmailHtml({
  bodyHtml,
  email,
  walletAddress,
  unsubscribeUrl,
}: RenderEmailOptions): string {
  let html = bodyHtml
    .replace(/\{\{\s*wallet_address\s*\}\}/gi, walletAddress ?? "")
    .replace(/\{\{\s*email\s*\}\}/gi, email);

  const usesToken = UNSUBSCRIBE_TOKEN.test(html);
  // .test() advances lastIndex on a /g regex, so reset before reusing it.
  UNSUBSCRIBE_TOKEN.lastIndex = 0;

  if (unsubscribeUrl) {
    html = usesToken
      ? html.replace(UNSUBSCRIBE_TOKEN, escapeAttribute(unsubscribeUrl))
      : html + unsubscribeButton(unsubscribeUrl);
  } else if (usesToken) {
    // No URL to give it: drop the token rather than emit a broken href.
    html = html.replace(UNSUBSCRIBE_TOKEN, "#");
  }

  return html;
}

/**
 * RFC 8058 one-click unsubscribe headers. Gmail and Yahoo require these for
 * bulk senders; Resend does not manage opt-outs for `emails.send`, so the URL
 * must point at our own endpoint (which handles both GET and POST).
 */
export function unsubscribeHeaders(
  unsubscribeUrl: string | null | undefined
): Record<string, string> | undefined {
  if (!unsubscribeUrl) return undefined;
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
