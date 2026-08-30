import {
  LEGACY_TAGLINE,
  NEKO_TAGLINE,
  renderEmailHtml,
  unsubscribeHeaders,
} from "./email-render";

const UNSUBSCRIBE_URL = "https://dapp.nekoprotocol.xyz/api/unsubscribe?token=x";

/** Stands in for a stored template: a complete document, not a fragment. */
const TEMPLATE = `<table><tr><td>
  <p>${NEKO_TAGLINE}</p>
  <h1>Welcome</h1>
  <p>Wallet {{wallet_address}} — sent to {{email}}</p>
</td></tr></table>`;

describe("renderEmailHtml", () => {
  it("returns the template's own document, not a re-branded copy of it", () => {
    const html = renderEmailHtml({
      bodyHtml: TEMPLATE,
      email: "user@test.io",
      walletAddress: "GABC",
    });
    expect(html).toContain("<h1>Welcome</h1>");
    // The template's own tagline appears once — it isn't wrapped in a second
    // branded shell carrying a duplicate.
    expect(html.split(NEKO_TAGLINE).length - 1).toBe(1);
    expect(html).not.toContain(LEGACY_TAGLINE);
  });

  it("substitutes recipient variables", () => {
    const html = renderEmailHtml({
      bodyHtml: TEMPLATE,
      email: "user@test.io",
      walletAddress: "GABC",
    });
    expect(html).toContain("Wallet GABC — sent to user@test.io");
    expect(html).not.toContain("{{");
  });

  it("places the unsubscribe URL where the template asks for it", () => {
    const html = renderEmailHtml({
      bodyHtml: '<a href="{{unsubscribe_url}}">Opt out</a>',
      email: "user@test.io",
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(html).toBe(
      `<a href="${UNSUBSCRIBE_URL.replace(/&/g, "&amp;")}">Opt out</a>`
    );
  });

  it("appends a button when the template has no unsubscribe token", () => {
    const html = renderEmailHtml({
      bodyHtml: "<p>hi</p>",
      email: "user@test.io",
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(html.startsWith("<p>hi</p>")).toBe(true);
    expect(html).toContain(">Unsubscribe<");
  });

  it("adds nothing when there is no unsubscribe URL", () => {
    const html = renderEmailHtml({
      bodyHtml: "<p>hi</p>",
      email: "admin@neko.xyz",
      unsubscribeUrl: null,
    });
    expect(html).toBe("<p>hi</p>");
  });

  it("never emits a live token when there is no URL to fill it with", () => {
    const html = renderEmailHtml({
      bodyHtml: '<a href="{{unsubscribe_url}}">Opt out</a>',
      email: "admin@neko.xyz",
      unsubscribeUrl: null,
    });
    expect(html).not.toContain("{{");
  });
});

describe("unsubscribeHeaders", () => {
  it("emits RFC 8058 one-click headers", () => {
    expect(unsubscribeHeaders(UNSUBSCRIBE_URL)).toEqual({
      "List-Unsubscribe": `<${UNSUBSCRIBE_URL}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("emits nothing without a URL, so no broken header is sent", () => {
    expect(unsubscribeHeaders(null)).toBeUndefined();
    expect(unsubscribeHeaders(undefined)).toBeUndefined();
  });
});
