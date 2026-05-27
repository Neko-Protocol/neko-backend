const EXPECTED_LENDING_POOL_IDS = [
  "CAPTJPAXEURYXEWGDSCCU3SZDYIP3U7KTS7VQM2EYLLK2JKIR4JIVWIH",
  "CD3HUT3N6LLUS4XZUWRIIJZUKN2B3UDDMEH2IMK6S3UKAHTZ6VKKBTYQ",
];

const EXPECTED_BACKSTOP_IDS = [
  "CCSNXCONDIFZADRJZZRHMRXDGTC6EMI7ZAYAJPJMXSDHBMOPBLBX5XQX",
  "CADKADCLXIZTU7Q3WS5M37HUF5BX3WCSTCM2ESN2JCJK5FBBH57FKSAV",
];

const EXPECTED_ORACLE_IDS = [
  "CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M",
  "CDJVAFSJTERWPYEZQJGN2N5N4BMXGMG6A2AWQK4C3V36MRYB4PRSNM2S",
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

void EXPECTED_LENDING_POOL_IDS;
void EXPECTED_BACKSTOP_IDS;
void EXPECTED_ORACLE_IDS;
void EXPECTED_DEFINDEX_VAULT_IDS;
void EXPECTED_BLEND_KEEPER_VAULT_IDS;

describe("ContractAllowlist (mainnet)", () => {
  describe("contains expected IDs by category", () => {
    it.todo(
      "includes all lending pool contractIds (EXPECTED_LENDING_POOL_IDS)"
    );

    it.todo(
      "includes all backstop contractIds (EXPECTED_BACKSTOP_IDS)"
    );

    it.todo(
      "includes all oracle contractIds (Reflector + legacy)"
    );

    it.todo(
      "includes all DeFindex Neko vault contractIds (EXPECTED_DEFINDEX_VAULT_IDS)"
    );

    it.todo(
      "includes all Blend keeper vault contractIds (EXPECTED_BLEND_KEEPER_VAULT_IDS)"
    );

    it.todo(
      "includes Soroswap router contractId (mainnet)"
    );

    it.todo(
      "includes Aqua AMM contractIds used by the dApp"
    );

    it.todo(
      "includes major asset SAC contractIds (XLM, USDC, EURC at minimum)"
    );
  });

  describe("has() semantics", () => {
    it.todo(
      "has(id) is case-sensitive: lowercased contractId returns false"
    );

    it.todo(
      "has(id) is exact-match: a prefix or suffix of a known id returns false"
    );

    it.todo(
      "has('') returns false"
    );

    it.todo(
      "has(<54-char garbage>) returns false"
    );

    it.todo(
      "has(<55-char garbage starting with C>) returns false (length match but not in set)"
    );
  });

  describe("invariants", () => {
    it.todo(
      "every allowlisted entry is a 56-char string starting with 'C' (Stellar contract id format)"
    );

    it.todo(
      "no duplicate entries"
    );

    it.todo(
      "size matches the sum of frontend constants categories above (snapshot test)"
    );
  });
});
