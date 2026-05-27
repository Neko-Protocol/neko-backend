/**
 * Mainnet contract IDs the dApp is permitted to invoke through the relay.
 *
 * Soroswap router / factory IDs are resolved at runtime via the Soroswap SDK
 * (no compile-time constant in the frontend) and must be added here once the
 * production address is confirmed — without them /tx/prepare will reject
 * Soroswap deposit/withdraw flows.
 */

export type ContractLabel = string;

export const CONTRACT_ALLOWLIST: ReadonlyMap<string, ContractLabel> = new Map([
  // ── Lending pools ──────────────────────────────────────────────────────────
  ["CAPTJPAXEURYXEWGDSCCU3SZDYIP3U7KTS7VQM2EYLLK2JKIR4JIVWIH", "lending:pool1"],
  ["CD3HUT3N6LLUS4XZUWRIIJZUKN2B3UDDMEH2IMK6S3UKAHTZ6VKKBTYQ", "lending:pool2"],

  // ── Backstops (kept in case re-introduced) ─────────────────────────────────
  [
    "CCSNXCONDIFZADRJZZRHMRXDGTC6EMI7ZAYAJPJMXSDHBMOPBLBX5XQX",
    "backstop:pool1",
  ],
  [
    "CADKADCLXIZTU7Q3WS5M37HUF5BX3WCSTCM2ESN2JCJK5FBBH57FKSAV",
    "backstop:pool2",
  ],

  // ── Oracles ────────────────────────────────────────────────────────────────
  ["CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M", "oracle:reflector"],
  [
    "CDJVAFSJTERWPYEZQJGN2N5N4BMXGMG6A2AWQK4C3V36MRYB4PRSNM2S",
    "oracle:lending",
  ],

  // ── Blend pool (public mainnet) ────────────────────────────────────────────
  ["CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI", "blend:pool"],

  // ── Asset SACs (mainnet) ───────────────────────────────────────────────────
  ["CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA", "asset:XLM"],
  ["CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", "asset:USDC"],
  ["CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV", "asset:EURC"],
  ["CB3YA656OYIHU57657I5KGSBRHE5I3OZU4VFC22PYAOANFZHEWNYGAGP", "asset:USDY"],
  ["CCCRWH6Q3FNP3I2I57BDLM5AFAT7O6OF6GKQOC6SSJNDAVRZ57SPHGU2", "asset:PYUSD"],
  ["CA67EQNWGPGXHVT6E4HQ65WEV54KFDB6HJDHVCJM33VKZ7XKR5MN3KPJ", "asset:GYEN"],
  ["CAL6ER2TI6CTRAY6BFXWNWA7WTYXUXTQCHUBCIBU5O6KM3HJFG6Z6VXV", "asset:CETES"],
  ["CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR", "asset:USTRY"],
  ["CD6M4R2322BYCY2LNWM74PEBQAQ63SA3DUJLI3L4225U4ZVCLMSCBCIS", "asset:TESOURO"],
  [
    "CC5CE6MWISDXT3MLNQ7R3FVILFVFEIH3COWGH45GJKL6BD2ZHF7F7JVI",
    "asset:EURC-blend",
  ],

  // ── DeFindex / Neko vaults ─────────────────────────────────────────────────
  ["CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ", "vault:EURC-neko"],
  ["CCUZC3HC5TH2VCYZFUG57E6IGKPL45YUN2SI3UEYQUBA7RCYHUIZBSFV", "vault:USDC-neko-fixed"],
  ["CANBU7T77SCJOOAU6VQAOGR7DN36JBQFUN56XS2WA2VPJYUSRUBIPYDS", "vault:CETES-neko"],
  ["CCIRVAW3IZVAYLHR7YYMZFOQVYEW67OKFFXR3J6ZR2T6YJC5V7GTSNQ5", "vault:USTRY-neko"],
  ["CBMERS7MJHO6TGKUVWWU34ZSKWCFOWPG2ZCIRIT75IC3YDWBIPBMV5LB", "vault:TESOURO-neko"],

  // ── Blend keeper vaults ────────────────────────────────────────────────────
  ["CDI2ZW5CKT4OIHX3IGMVJ4VGOH6Z64N2M3URKATYJIX7JRITJFQJPFD7", "vault:CETES-blend"],
  ["CBYTDU4JKTMFG5CNIUYJTOVMNIN5ADU2PDG4QWIUVT6SSVK3VTXYTF4K", "vault:USTRY-blend"],
  ["CCM3CKJI7BBMZ357644KLAE6NH4D7JQ6MUJHSV4UBRWJY7IMGHBJRNGR", "vault:USDC-blend"],
  ["CAXRLUOSI7DL3SYNZW5UGRIPVNRKKSZTW35OX5DWKZSJ4PFEVA2VEFCQ", "vault:TESOURO-blend"],

  // ── Aqua AMM ───────────────────────────────────────────────────────────────
  ["CBQDHNBFBZYE4MKPWBSJOPIYLW4SFSXAXUTSXJN76GNKYVYPCKWC6QUK", "aqua:router"],
  ["CA6GAFOJCW4MGQQBUCQUSA3CLIH25G4SNKB2JHYKZCVWZTNW5VXMSC4O", "aqua:pool:01"],
  ["CCY2PXGMKNQHO7WNYXEWX76L2C5BH3JUW3RCATGUYKY7QQTRILBZIFWV", "aqua:pool:02"],
  ["CAFHLHGZXOVNCGFJ7DOXL7JDNMBCEZKDI3LS5NRQH3GXC7CSIMQZHUSM", "aqua:pool:03"],
  ["CCX2TYR4AQTPPMTZOIMP3YIBHAYLLSTXVP47PAGTL753PCQFSKV32MIA", "aqua:pool:04"],
  ["CCKGQSQG5JLZBMYMB4HT6M4H7FUC3NK5C75MIHN6627LRAY5B2SYL2AD", "aqua:pool:05"],
  ["CA6PUJLBYKZKUEKLZJMKBZLEKP2OTHANDEOWSFF44FTSYLKQPIICCJBE", "aqua:pool:06"],
  ["CDMH535JSD224YXPET3B4SJOLXTQQ24GRSCWACGYBKSH2DKFJYWI7SUW", "aqua:pool:07"],
  ["CB37QM6EHVBDDNK7MAVQESV7WPLKV6G36TR7MHAOYWPZXLPQUWSDOK4E", "aqua:pool:08"],
  ["CDPF7GMA3OLVUBLEVKNKXKEFSS3EQAXN75RHT7DR4SYIHFS5LH5JOTD7", "aqua:pool:09"],
  ["CAB6MICC2WKRT372U3FRPKGGVB5R3FDJSMWSLPF2UJNJPYMBZ76RQVYE", "aqua:pool:10"],
  ["CDE57N6XTUPBKYYDGQMXX7E7SLNOLFY3JEQB4MULSMR2AKTSAENGX2HC", "aqua:pool:11"],
  ["CAC56QNJ2CX456TPC5S4MSOU3DBULG4TGN7AZ2SAYGBLD3GICFMZBIT2", "aqua:pool:12"],
  ["CARCLMAPEV4GYZ3TTFJDQHSNC7PH4G22UIMMER6BZW5H2TYZWWMW7FOS", "aqua:pool:13"],
  ["CCSY43EHJAHT3NQDYKAMJXRFBEEH7OXDL3J3VNGO33UUSEXWNN27GBIZ", "aqua:pool:14"],
  ["CADFWSBBD6VMCL45DEPZ37X3JNXOZXIWEVJJTHMQH3UEB3JSQVJSPG2I", "aqua:pool:15"],
  ["CBRXOYKXPQI4EEA6KA35TUIYN5OJLNWMTIVDOMNOIL2BG5Y5LEDHUU7V", "aqua:pool:16"],
]);

/**
 * Operation names (Soroban host function symbols) accepted by /tx/prepare.
 * Anything outside this set is rejected with DISALLOWED_OPERATION.
 */
export const ALLOWED_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  // Lending / vault writes
  "deposit",
  "withdraw",
  "borrow",
  "repay",
  "claim",
  "claim_rewards",
  "claimRewards",
  "submit",
  // Token writes
  "mint",
  "burn",
  "transfer",
  "approve",
  // Soroswap / Aqua liquidity
  "add_liquidity",
  "remove_liquidity",
  "addLiquidity",
  "removeLiquidity",
  "swap",
  "swap_exact_tokens_for_tokens",
  "swap_tokens_for_exact_tokens",
  "swap_chained",
  // DeFindex
  "invest",
  "rescue",
  "rebalance",
]);

export function isAllowedContract(contractId: string): boolean {
  return CONTRACT_ALLOWLIST.has(contractId);
}

export function getContractLabel(contractId: string): string | undefined {
  return CONTRACT_ALLOWLIST.get(contractId);
}

export function isAllowedFunction(name: string): boolean {
  return ALLOWED_FUNCTION_NAMES.has(name);
}
