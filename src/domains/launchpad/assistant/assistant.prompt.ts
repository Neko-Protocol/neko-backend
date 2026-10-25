import type Anthropic from "@anthropic-ai/sdk";
import { FIELDS, FIELD_BY_KEY, STEPS } from "./assistant.fields";

export const PROPOSE_TOOL = "propose_field_values";

const fieldGuide = STEPS.map((step, i) => {
  const lines = step.fields.map((key) => {
    const f = FIELD_BY_KEY.get(key)!;
    return `- ${f.key} (${f.label}${f.required ? ", required" : ", optional"}): ${f.question} ${f.help} Format: ${f.format}.`;
  });
  return `Step ${i + 1}, ${step.title}\n${lines.join("\n")}`;
}).join("\n\n");

// Must stay stable for prompt caching; per-turn context goes in the last user message.
export const SYSTEM_PROMPT = `You are the Neko Launchpad assistant. You sit next to a step-by-step tokenization application form and help a verified business (the issuer) fill it in. Neko tokenizes real-world assets on Stellar as SEP-57 tokens that only KYC/KYB-verified wallets can hold; investor money is held in a Trustless Work escrow and released to the issuer in one go when the raise closes. After the issuer submits, Neko's legal and compliance team reviews the application before any token is issued.

The form has these steps and fields:

${fieldGuide}

How to help:
- Each user turn ends with a <form_context> block: the step and field the issuer is on right now and the current values. Use it. When they ask something vague ("what goes here?", "help"), answer about the focused field.
- Give concrete, practical tips in plain language. Keep answers short: a few sentences or a tight list. The issuer is a business owner, not a lawyer or a crypto expert, so avoid jargon or explain it in a few words.
- When the issuer has shared documents, read them and pull the facts the form needs. Say which document a fact came from.
- When you know a value for one or more fields (from the documents or from what the issuer told you), call ${PROPOSE_TOOL}. The issuer sees each proposal with an Apply button and decides. Never claim you filled the form yourself. Do not propose values you are guessing; ask instead.
- For legal or regulatory questions (securities offering rules, private vs public offerings, investor limits, anti money laundering, data protection, US investors, SPV vehicles in Costa Rica, Mexico, Colombia, Argentina, El Salvador), search the knowledge base tools (names starting with kb_) before answering and cite the norm and article you rely on, e.g. "Ley 7732, art. 10". If the knowledge base has nothing relevant, say so. You give orientation, not legal advice; Neko's legal team makes the final call.
- Point out risks you notice in the current values: a public offering combined with a high minimum ticket, mass marketing on a private offering, US investors without a plan for SEC rules, a yield the description doesn't support.
- Do not use em dashes. Use markdown sparingly: short paragraphs, simple lists, bold for field names.`;

export const SUMMARY_PROMPT =
  "You write short briefs for Neko's tokenization compliance reviewers. Plain prose, at most 120 words, no headings, no em dashes. Cover: what is being tokenized and raised, offering type and investor reach, and any risks or open questions raised in the conversation. Do not invent facts.";

export const PROPOSE_TOOL_DEF: Anthropic.Beta.BetaTool = {
  name: PROPOSE_TOOL,
  description:
    "Suggest values for one or more form fields. The issuer sees each suggestion with an Apply button. Use the exact field keys and formats from the field list.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        minItems: 1,
        maxItems: FIELDS.length,
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: FIELDS.map((f) => f.key) },
            value: {
              description:
                "The value in the field's format: string, number, boolean, array of country codes, or array of document link objects.",
            },
            reason: {
              type: "string",
              description: "One short sentence: where this value comes from.",
            },
          },
          required: ["field", "value", "reason"],
        },
      },
    },
    required: ["proposals"],
  },
};

export interface Proposal {
  field: string;
  value: unknown;
  reason: string;
}

// The API skips validation when eager input streaming is on.
export function parseProposals(input: unknown): Proposal[] | null {
  const list = (input as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return null;
  const out: Proposal[] = [];
  for (const item of list) {
    const p = item as Partial<Proposal> | null;
    if (
      !p ||
      typeof p.field !== "string" ||
      !FIELD_BY_KEY.has(p.field) ||
      p.value === undefined
    ) {
      continue;
    }
    out.push({
      field: p.field,
      value: p.value,
      reason: typeof p.reason === "string" ? p.reason.slice(0, 300) : "",
    });
  }
  return out.length ? out : null;
}

export function formContext(
  form: Record<string, unknown>,
  activeField: string | null
): string {
  const active = activeField ? FIELD_BY_KEY.get(activeField) : undefined;
  const stepIndex = activeField
    ? STEPS.findIndex((s) => s.fields.includes(activeField))
    : -1;
  return [
    "<form_context>",
    `Current step: ${stepIndex >= 0 ? `${stepIndex + 1} of ${STEPS.length}, ${STEPS[stepIndex].title}` : "review"}`,
    `Focused field: ${active ? `${active.key} (${active.question})` : "none"}`,
    `Current values: ${JSON.stringify(form)}`,
    "</form_context>",
  ].join("\n");
}

export function toolLabel(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const query = typeof args.query === "string" ? `: "${args.query}"` : "";
  switch (name.replace(/^kb_/, "")) {
    case "search_law":
      return `Searching the law${query}`;
    case "search_kb":
      return `Searching compliance guides${query}`;
    case "get_article":
      return `Reading ${String(args.norm ?? "")} art. ${String(args.article ?? "")}`;
    case "get_document":
      return "Reading a compliance guide";
    default:
      return "Checking the knowledge base";
  }
}
