import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import { DiditService, extractIdentity, mapDiditStatus } from "./didit.service";

const SECRET = "whsec-test";
const NOW = 1_800_000_000;

function makeService(env: Record<string, string> = {}) {
  const values: Record<string, string> = {
    DIDIT_API_KEY: "key",
    DIDIT_WEBHOOK_SECRET: SECRET,
    ...env,
  };
  return new DiditService({
    get: (k: string) => values[k],
  } as unknown as ConfigService);
}

const sign = (payload: string) =>
  createHmac("sha256", SECRET).update(payload).digest("hex");

describe("mapDiditStatus", () => {
  it.each([
    ["Approved", "approved"],
    ["APPROVED", "approved"],
    ["Declined", "declined"],
    ["In Review", "in_review"],
    ["In Progress", "in_progress"],
    ["Awaiting User", "in_progress"],
    ["Resubmitted", "in_progress"],
    ["Abandoned", "expired"],
    ["Kyc Expired", "expired"],
    ["Not Started", "pending"],
    [undefined, "pending"],
  ])("%s -> %s", (input, expected) => {
    expect(mapDiditStatus(input)).toBe(expected);
  });
});

describe("extractIdentity", () => {
  it("reads the person from id_verifications", () => {
    expect(
      extractIdentity({
        session_id: "s",
        status: "Approved",
        id_verifications: [
          { first_name: "Ana", last_name: "Mora", issuing_state: "CRI" },
        ],
      })
    ).toEqual({ fullName: "Ana Mora", businessName: null, country: "CRI" });
  });

  it("reads the company from registry_checks", () => {
    expect(
      extractIdentity({
        session_id: "s",
        status: "Approved",
        registry_checks: [
          { company: { company_name: "Café SA", country_code: "CR" } },
        ],
      })
    ).toEqual({ fullName: null, businessName: "Café SA", country: "CR" });
  });
});

describe("DiditService.verifyWebhook", () => {
  const body = JSON.stringify({ status: "Approved", session_id: "abc" });
  const raw = Buffer.from(body);

  it("accepts X-Signature over the raw body", () => {
    expect(
      makeService().verifyWebhook(
        raw,
        { "x-timestamp": String(NOW), "x-signature": sign(body) },
        NOW
      )
    ).toBe(true);
  });

  it("accepts X-Signature-V2 over sorted-key JSON", () => {
    const canonical = JSON.stringify({ session_id: "abc", status: "Approved" });
    expect(
      makeService().verifyWebhook(
        raw,
        { "x-timestamp": String(NOW), "x-signature-v2": sign(canonical) },
        NOW
      )
    ).toBe(true);
  });

  it("rejects a bad signature", () => {
    expect(
      makeService().verifyWebhook(
        raw,
        { "x-timestamp": String(NOW), "x-signature": sign("other") },
        NOW
      )
    ).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    expect(
      makeService().verifyWebhook(
        raw,
        { "x-timestamp": String(NOW - 301), "x-signature": sign(body) },
        NOW
      )
    ).toBe(false);
  });

  it("rejects everything when the secret is unset", () => {
    expect(
      makeService({ DIDIT_WEBHOOK_SECRET: "" }).verifyWebhook(
        raw,
        { "x-timestamp": String(NOW), "x-signature": sign(body) },
        NOW
      )
    ).toBe(false);
  });
});
