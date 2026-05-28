import {
  ALLOWED_FUNCTION_NAMES,
  CONTRACT_ALLOWLIST,
  getContractLabel,
  isAllowedContract,
  isAllowedFunction,
} from "./contract-allowlist";

const EXPECTED_BLEND_POOL_ID =
  "CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI";

const EXPECTED_ORACLE_IDS = [
  "CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M",
];

const EXPECTED_DEFINDEX_VAULT_IDS = [
  "CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ", // EURC
  "CCUZC3HC5TH2VCYZFUG57E6IGKPL45YUN2SI3UEYQUBA7RCYHUIZBSFV", // USDC
  "CANBU7T77SCJOOAU6VQAOGR7DN36JBQFUN56XS2WA2VPJYUSRUBIPYDS", // CETES
  "CCIRVAW3IZVAYLHR7YYMZFOQVYEW67OKFFXR3J6ZR2T6YJC5V7GTSNQ5", // USTRY
  "CBMERS7MJHO6TGKUVWWU34ZSKWCFOWPG2ZCIRIT75IC3YDWBIPBMV5LB", // TESOURO
];

const EXPECTED_BLEND_KEEPER_VAULT_IDS = [
  "CDI2ZW5CKT4OIHX3IGMVJ4VGOH6Z64N2M3URKATYJIX7JRITJFQJPFD7", // CETES
  "CBYTDU4JKTMFG5CNIUYJTOVMNIN5ADU2PDG4QWIUVT6SSVK3VTXYTF4K", // USTRY
  "CCM3CKJI7BBMZ357644KLAE6NH4D7JQ6MUJHSV4UBRWJY7IMGHBJRNGR", // USDC
  "CAXRLUOSI7DL3SYNZW5UGRIPVNRKKSZTW35OX5DWKZSJ4PFEVA2VEFCQ", // TESOURO
];

const EXPECTED_ASSET_SAC_IDS = [
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA", // XLM
  "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", // USDC
  "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV", // EURC
];

describe("ContractAllowlist (mainnet)", () => {
  describe("contains expected IDs by category", () => {
    it("includes the Blend public-mainnet pool contractId", () => {
      expect(isAllowedContract(EXPECTED_BLEND_POOL_ID)).toBe(true);
    });

    it("includes the Reflector oracle contractId", () => {
      for (const id of EXPECTED_ORACLE_IDS) {
        expect(isAllowedContract(id)).toBe(true);
      }
    });

    it("includes all DeFindex Neko vault contractIds", () => {
      for (const id of EXPECTED_DEFINDEX_VAULT_IDS) {
        expect(isAllowedContract(id)).toBe(true);
      }
    });

    it("includes all Blend keeper vault contractIds", () => {
      for (const id of EXPECTED_BLEND_KEEPER_VAULT_IDS) {
        expect(isAllowedContract(id)).toBe(true);
      }
    });

    it("includes Aqua AMM router and pool contractIds", () => {
      expect(
        isAllowedContract(
          "CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK"
        )
      ).toBe(true);
      const aquaPoolCount = Array.from(CONTRACT_ALLOWLIST.values()).filter(
        (label) => label.startsWith("aqua:pool:")
      ).length;
      expect(aquaPoolCount).toBeGreaterThanOrEqual(8);
    });

    it("includes major asset SAC contractIds (XLM, USDC, EURC at minimum)", () => {
      for (const id of EXPECTED_ASSET_SAC_IDS) {
        expect(isAllowedContract(id)).toBe(true);
      }
    });
  });

  describe("isAllowedContract semantics", () => {
    it("is case-sensitive: lowercased contractId returns false", () => {
      const id = EXPECTED_BLEND_POOL_ID;
      expect(isAllowedContract(id)).toBe(true);
      expect(isAllowedContract(id.toLowerCase())).toBe(false);
    });

    it("is exact-match: a prefix of a known id returns false", () => {
      const id = EXPECTED_BLEND_POOL_ID;
      expect(isAllowedContract(id.slice(0, 55))).toBe(false);
    });

    it("is exact-match: a suffix of a known id returns false", () => {
      const id = EXPECTED_BLEND_POOL_ID;
      expect(isAllowedContract(id.slice(1))).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isAllowedContract("")).toBe(false);
    });

    it("returns false for 55-char garbage starting with C", () => {
      expect(isAllowedContract("C" + "0".repeat(54))).toBe(false);
    });
  });

  describe("getContractLabel", () => {
    it("returns the namespaced label for an allowlisted id", () => {
      expect(getContractLabel(EXPECTED_BLEND_POOL_ID)).toBe("blend:pool");
      expect(
        getContractLabel(
          "CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ"
        )
      ).toBe("vault:EURC-neko");
    });

    it("returns undefined for a non-allowlisted id", () => {
      expect(getContractLabel("C" + "0".repeat(55))).toBeUndefined();
    });

    it("returns undefined for the legacy testnet lending pool addresses", () => {
      const removedTestnetIds = [
        "CAPTJPAXEURYXEWGDSCCU3SZDYIP3U7KTS7VQM2EYLLK2JKIR4JIVWIH",
        "CD3HUT3N6LLUS4XZUWRIIJZUKN2B3UDDMEH2IMK6S3UKAHTZ6VKKBTYQ",
        "CCSNXCONDIFZADRJZZRHMRXDGTC6EMI7ZAYAJPJMXSDHBMOPBLBX5XQX",
        "CADKADCLXIZTU7Q3WS5M37HUF5BX3WCSTCM2ESN2JCJK5FBBH57FKSAV",
        "CDJVAFSJTERWPYEZQJGN2N5N4BMXGMG6A2AWQK4C3V36MRYB4PRSNM2S",
      ];
      for (const id of removedTestnetIds) {
        expect(getContractLabel(id)).toBeUndefined();
        expect(isAllowedContract(id)).toBe(false);
      }
    });
  });

  describe("ALLOWED_FUNCTION_NAMES + isAllowedFunction", () => {
    it("includes the core lending/vault write functions", () => {
      for (const fn of [
        "deposit",
        "withdraw",
        "borrow",
        "repay",
        "submit",
        "claim",
        "claim_rewards",
        "claimRewards",
      ]) {
        expect(isAllowedFunction(fn)).toBe(true);
      }
    });

    it("rejects raw SAC token-write functions as top-level ops", () => {
      // transfer/approve/mint/burn must only appear as nested authorized
      // sub-invocations inside protocol calls (Blend pool submit, Soroswap
      // swap, etc.), never as top-level ops — otherwise a signed XDR could
      // drain funds to arbitrary destinations via the relay.
      for (const fn of ["mint", "burn", "transfer", "approve"]) {
        expect(isAllowedFunction(fn)).toBe(false);
      }
    });

    it("includes swap and liquidity functions", () => {
      for (const fn of [
        "swap",
        "swap_exact_tokens_for_tokens",
        "swap_tokens_for_exact_tokens",
        "swap_chained",
        "add_liquidity",
        "remove_liquidity",
        "addLiquidity",
        "removeLiquidity",
      ]) {
        expect(isAllowedFunction(fn)).toBe(true);
      }
    });

    it("includes DeFindex management functions", () => {
      for (const fn of ["invest", "rescue", "rebalance"]) {
        expect(isAllowedFunction(fn)).toBe(true);
      }
    });

    it("rejects unknown / admin-style functions", () => {
      for (const fn of [
        "admin_transfer",
        "set_admin",
        "upgrade",
        "",
        "DEPOSIT", // case-sensitive
      ]) {
        expect(isAllowedFunction(fn)).toBe(false);
      }
    });
  });

  describe("invariants", () => {
    it("every allowlisted entry is a 56-char string starting with C", () => {
      for (const id of CONTRACT_ALLOWLIST.keys()) {
        expect(id).toHaveLength(56);
        expect(id.startsWith("C")).toBe(true);
      }
    });

    it("no duplicate contract IDs", () => {
      const keys = Array.from(CONTRACT_ALLOWLIST.keys());
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("no duplicate function names", () => {
      const fns = Array.from(ALLOWED_FUNCTION_NAMES);
      expect(new Set(fns).size).toBe(fns.length);
    });

    it("allowlist covers every documented category snapshot count", () => {
      expect(CONTRACT_ALLOWLIST.size).toBeGreaterThanOrEqual(
        1 + // Blend public-mainnet pool
          EXPECTED_ORACLE_IDS.length +
          EXPECTED_DEFINDEX_VAULT_IDS.length +
          EXPECTED_BLEND_KEEPER_VAULT_IDS.length +
          EXPECTED_ASSET_SAC_IDS.length
      );
    });
  });
});
