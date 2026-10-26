// Mirrors the form steps in neko-tokenization-hackmeridian
// (apps/platform/src/features/application/utils/fields.ts).

export const ASSET_TYPES = [
  "real_estate",
  "private_credit",
  "invoices",
  "agriculture",
  "energy",
  "other",
] as const;

export interface FieldSpec {
  key: string;
  label: string;
  question: string;
  help: string;
  required: boolean;
  format: string;
}

export const FIELDS: FieldSpec[] = [
  {
    key: "issuer_name",
    label: "Legal name",
    question: "What's the issuer's legal name?",
    help: "The company that owns the asset and will issue the token, exactly as it appears in the company registry.",
    required: true,
    format: "string, max 200 characters",
  },
  {
    key: "issuer_country",
    label: "Country",
    question: "Where is the company incorporated?",
    help: "This decides which securities, anti money laundering and data protection laws apply first.",
    required: true,
    format: "ISO 3166-1 alpha-2 code, e.g. CR",
  },
  {
    key: "asset_type",
    label: "Asset type",
    question: "What kind of asset is it?",
    help: "Pick the category that best describes what backs the token.",
    required: true,
    format: `one of: ${ASSET_TYPES.join(", ")}`,
  },
  {
    key: "asset_name",
    label: "Asset name",
    question: "What should investors call it?",
    help: "A short, clear name, like 'Escazú Office Tower, Floor 4' or 'Q3 2026 Coffee Harvest'.",
    required: true,
    format: "string, max 200 characters",
  },
  {
    key: "description",
    label: "Description",
    question: "How does it make money?",
    help: "What the asset is, how it produces returns, who operates it and what investors receive. Plain language, no hype.",
    required: true,
    format: "string, max 4000 characters",
  },
  {
    key: "target_amount",
    label: "Target raise",
    question: "How much do you want to raise?",
    help: "The total you need from investors. Funds are released to you in one go when the raise closes.",
    required: true,
    format: "positive number, no symbols, e.g. 250000",
  },
  {
    key: "currency",
    label: "Currency",
    question: "In which currency?",
    help: "Fixed to USD for now: investments settle in USDC on Stellar.",
    required: true,
    format: "always USD, do not propose another currency",
  },
  {
    key: "min_ticket",
    label: "Minimum investment",
    question: "What's the smallest amount someone can invest?",
    help: "Lower minimums reach more people.",
    required: true,
    format: "positive number, e.g. 100",
  },
  {
    key: "min_target",
    label: "Minimum raise",
    question: "What's the least you need for the raise to go ahead?",
    help: "If investors put in less than this by the funding deadline, the raise fails and everyone gets their money back.",
    required: true,
    format: "positive number, at least the minimum investment and at most the target raise, e.g. 125000",
  },
  {
    key: "expected_yield_pct",
    label: "Annual yield (%)",
    question: "What yearly return can investors expect?",
    help: "As a percentage. Only state what the asset can realistically pay.",
    required: true,
    format: "number, e.g. 9.5",
  },
  {
    key: "term_months",
    label: "Term (months)",
    question: "When do investors get their money back?",
    help: "The length of the investment, in months.",
    required: true,
    format: "whole number of months, e.g. 18",
  },
  {
    key: "milestones",
    label: "Repayment schedule",
    question: "How will you pay investors back?",
    help: "Split the total repayment, principal plus interest, into dated payments. Name each one after what the issuer will have achieved by then; Neko checks that progress on-chain.",
    required: true,
    format: "array of { title: string, amount_pct: number, due: YYYY-MM-DD }, 1 to 12 entries, percentages add up to 100, dates in order",
  },
  {
    key: "investor_countries",
    label: "Investor countries",
    question: "Where are your investors?",
    help: "Each country adds its own rules, so start with the ones you need.",
    required: true,
    format: 'array of ISO 3166-1 alpha-2 codes, e.g. ["CR", "MX"]',
  },
  {
    key: "max_investors",
    label: "Maximum investors",
    question: "Is there a limit on how many people can invest?",
    help: "Private offerings usually stay under a legal cap on the number of investors.",
    required: false,
    format: "whole number, e.g. 50",
  },
  {
    key: "accepts_us_investors",
    label: "US investors",
    question: "Will you accept investors from the United States?",
    help: "Selling to US persons brings in SEC rules (Regulation D, S or Crowdfunding).",
    required: true,
    format: "boolean",
  },
  {
    key: "uses_mass_marketing",
    label: "Public advertising",
    question: "Will you advertise the offering publicly?",
    help: "Social media ads, newsletters or events aimed at the general public can turn a private offering into a public one.",
    required: true,
    format: "boolean",
  },
  {
    key: "documents",
    label: "Documents",
    question: "Anything reviewers should see?",
    help: "Files or links to title deeds, appraisals, financial statements or contracts. Files shared in the assistant chat are not attached and are deleted when the issuer submits.",
    required: false,
    format: "array of { name: string, url: https URL }, max 12",
  },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export const STEPS: { title: string; fields: string[] }[] = [
  { title: "Who's issuing", fields: ["issuer_name", "issuer_country"] },
  { title: "Asset type", fields: ["asset_type"] },
  { title: "The asset", fields: ["asset_name", "description"] },
  {
    title: "Your raise",
    fields: ["target_amount", "currency", "min_ticket", "min_target"],
  },
  { title: "Returns", fields: ["expected_yield_pct", "term_months"] },
  { title: "Repayment", fields: ["milestones"] },
  { title: "Investors", fields: ["investor_countries", "max_investors"] },
  { title: "US investors", fields: ["accepts_us_investors"] },
  { title: "Advertising", fields: ["uses_mass_marketing"] },
  { title: "Documents", fields: ["documents"] },
];
