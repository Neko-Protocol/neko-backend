import type { ApplicationRow } from "./launchpad.types";

export type ApplicationSimilarityFields = Pick<
  ApplicationRow,
  | "asset_type"
  | "offering_type"
  | "issuer_country"
  | "target_amount"
  | "investor_countries"
  | "accepts_us_investors"
  | "uses_mass_marketing"
>;

export function scoreApplicationSimilarity(
  target: ApplicationSimilarityFields,
  candidate: ApplicationSimilarityFields
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  const match = (condition: boolean, points: number, reason: string) => {
    if (condition) {
      score += points;
      matched.push(reason);
    }
  };

  match(target.asset_type === candidate.asset_type, 3, "same asset type");
  match(
    target.offering_type === candidate.offering_type,
    2,
    "same offering type"
  );
  match(target.issuer_country === candidate.issuer_country, 2, "same country");

  const targetAmount = Number(target.target_amount);
  const candidateAmount = Number(candidate.target_amount);
  match(
    Number.isFinite(targetAmount) &&
      Number.isFinite(candidateAmount) &&
      targetAmount > 0 &&
      candidateAmount >= targetAmount * 0.5 &&
      candidateAmount <= targetAmount * 2,
    1,
    "similar target amount"
  );
  match(
    target.investor_countries.some((country) =>
      candidate.investor_countries.includes(country)
    ),
    1,
    "overlapping investor countries"
  );
  match(
    target.accepts_us_investors === candidate.accepts_us_investors,
    1,
    "same US investor policy"
  );
  match(
    target.uses_mass_marketing === candidate.uses_mass_marketing,
    1,
    "same mass marketing policy"
  );

  return { score, matched };
}
