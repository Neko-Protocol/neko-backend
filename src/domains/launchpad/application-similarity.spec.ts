import {
  scoreApplicationSimilarity,
  type ApplicationSimilarityFields,
} from "./application-similarity";

const TARGET: ApplicationSimilarityFields = {
  asset_type: "agriculture",
  offering_type: "private",
  issuer_country: "CR",
  target_amount: 1000,
  investor_countries: ["CR", "PA"],
  accepts_us_investors: false,
  uses_mass_marketing: false,
};

const DIFFERENT: ApplicationSimilarityFields = {
  asset_type: "energy",
  offering_type: "public",
  issuer_country: "MX",
  target_amount: 5000,
  investor_countries: ["MX"],
  accepts_us_investors: true,
  uses_mass_marketing: true,
};

describe("scoreApplicationSimilarity", () => {
  it("combines all seven signals, including matching false policies", () => {
    expect(scoreApplicationSimilarity(TARGET, TARGET)).toEqual({
      score: 11,
      matched: [
        "same asset type",
        "same offering type",
        "same country",
        "similar target amount",
        "overlapping investor countries",
        "same US investor policy",
        "same mass marketing policy",
      ],
    });
  });

  it.each<[Partial<ApplicationSimilarityFields>, number, string]>([
    [{ asset_type: "agriculture" }, 3, "same asset type"],
    [{ offering_type: "private" }, 2, "same offering type"],
    [{ issuer_country: "CR" }, 2, "same country"],
    [{ target_amount: "1000.00" }, 1, "similar target amount"],
    [
      { investor_countries: ["PA", "PA", "CR"] },
      1,
      "overlapping investor countries",
    ],
    [{ accepts_us_investors: false }, 1, "same US investor policy"],
    [{ uses_mass_marketing: false }, 1, "same mass marketing policy"],
  ])("scores a matching field independently: %j", (fields, score, reason) => {
    expect(
      scoreApplicationSimilarity(TARGET, { ...DIFFERENT, ...fields })
    ).toEqual({ score, matched: [reason] });
  });

  it.each([500, 2000, "500.00", "2000.00"])(
    "includes the amount boundary %s",
    (target_amount) => {
      expect(
        scoreApplicationSimilarity(
          { ...TARGET, target_amount: "1000.00" },
          { ...DIFFERENT, target_amount }
        )
      ).toEqual({ score: 1, matched: ["similar target amount"] });
    }
  );

  it.each([499.99, 2000.01, "invalid", 0, Infinity])(
    "does not match amount %s",
    (target_amount) => {
      expect(
        scoreApplicationSimilarity(TARGET, { ...DIFFERENT, target_amount })
      ).toEqual({ score: 0, matched: [] });
    }
  );

  it("returns zero when nothing matches", () => {
    expect(scoreApplicationSimilarity(TARGET, DIFFERENT)).toEqual({
      score: 0,
      matched: [],
    });
  });

  it("does not count empty investor country lists as overlap", () => {
    expect(
      scoreApplicationSimilarity(
        { ...TARGET, investor_countries: [] },
        { ...DIFFERENT, investor_countries: [] }
      )
    ).toEqual({ score: 0, matched: [] });
  });
});
