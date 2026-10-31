import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashClaimToken(token) };
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function claimTokenMatches(
  token: string | undefined,
  expectedHash: string
): boolean {
  if (!token) return false;
  const a = Buffer.from(hashClaimToken(token));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
