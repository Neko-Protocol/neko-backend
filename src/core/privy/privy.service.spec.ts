import type { LinkedAccount } from "@privy-io/node";
import { toProfile } from "./privy.service";

const accounts = (list: Record<string, unknown>[]) =>
  list as unknown as LinkedAccount[];

describe("toProfile", () => {
  it("keeps only Privy-embedded Stellar wallets and normalises email", () => {
    const profile = toProfile(
      "did:privy:abc",
      accounts([
        { type: "email", address: "Ana@Example.com" },
        {
          type: "wallet",
          chain_type: "stellar",
          wallet_client_type: "privy",
          address: "GAAA",
          id: "w1",
        },
        {
          type: "wallet",
          chain_type: "stellar",
          wallet_client_type: "privy-v2",
          address: "GCCC",
          id: "w2",
        },
        {
          type: "wallet",
          chain_type: "ethereum",
          wallet_client_type: "privy",
          address: "0xabc",
        },
        {
          type: "wallet",
          chain_type: "stellar",
          wallet_client_type: "freighter",
          address: "GBBB",
        },
      ])
    );
    expect(profile).toEqual({
      userId: "did:privy:abc",
      email: "ana@example.com",
      stellarWallets: [
        { address: "GAAA", walletId: "w1" },
        { address: "GCCC", walletId: "w2" },
      ],
    });
  });

  it("falls back to OAuth emails", () => {
    expect(
      toProfile("u", accounts([{ type: "google_oauth", email: "g@x.com" }]))
        .email
    ).toBe("g@x.com");
  });
});
