import { ConfigService } from "@nestjs/config";
import type { LinkedAccount } from "@privy-io/node";
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { PrivyService, toProfile } from "./privy.service";

const APP_ID = "app-test";

async function setup(env: Record<string, string> = {}) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const pem = await exportSPKI(publicKey);
  const values: Record<string, string> = {
    PRIVY_APP_ID: APP_ID,
    PRIVY_APP_SECRET: "secret",
    PRIVY_VERIFICATION_KEY: pem.replace(/\n/g, "\\n"),
    ...env,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return { service: new PrivyService(config), privateKey };
}

function token(
  key: CryptoKey,
  claims: { iss?: string; aud?: string; sub?: string; exp?: string } = {}
) {
  return new SignJWT({ sid: "session-1" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(claims.iss ?? "privy.io")
    .setAudience(claims.aud ?? APP_ID)
    .setSubject(claims.sub ?? "did:privy:abc")
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "1h")
    .sign(key);
}

describe("PrivyService.verifyAccessToken", () => {
  it("accepts a valid token", async () => {
    const { service, privateKey } = await setup();
    await expect(
      service.verifyAccessToken(await token(privateKey))
    ).resolves.toEqual({ userId: "did:privy:abc", sessionId: "session-1" });
  });

  it.each([
    ["wrong issuer", { iss: "evil.io" }],
    ["wrong audience", { aud: "other-app" }],
    ["expired", { exp: "-1m" }],
  ])("rejects %s", async (_label, claims) => {
    const { service, privateKey } = await setup();
    await expect(
      service.verifyAccessToken(await token(privateKey, claims))
    ).rejects.toMatchObject({
      response: { code: "PRIVY_TOKEN_INVALID" },
    });
  });

  it("rejects a token signed by another key", async () => {
    const { service } = await setup();
    const other = await generateKeyPair("ES256");
    await expect(
      service.verifyAccessToken(await token(other.privateKey))
    ).rejects.toMatchObject({ response: { code: "PRIVY_TOKEN_INVALID" } });
  });

  it("rejects a token without typ JWT", async () => {
    const { service, privateKey } = await setup();
    const untyped = await new SignJWT({ sid: "s" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("privy.io")
      .setAudience(APP_ID)
      .setSubject("did:privy:abc")
      .setExpirationTime("1h")
      .sign(privateKey);
    await expect(service.verifyAccessToken(untyped)).rejects.toMatchObject({
      response: { code: "PRIVY_TOKEN_INVALID" },
    });
  });

  it("answers PRIVY_NOT_CONFIGURED when env is missing", async () => {
    const { service, privateKey } = await setup({ PRIVY_APP_SECRET: "" });
    expect(service.isConfigured()).toBe(false);
    await expect(
      service.verifyAccessToken(await token(privateKey))
    ).rejects.toMatchObject({ response: { code: "PRIVY_NOT_CONFIGURED" } });
  });
});

/** Partial fixtures; the SDK type requires every verification field. */
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
      stellarWallets: [{ address: "GAAA", walletId: "w1" }],
    });
  });

  it("falls back to OAuth emails", () => {
    expect(
      toProfile("u", accounts([{ type: "google_oauth", email: "g@x.com" }]))
        .email
    ).toBe("g@x.com");
  });
});
