import { Asset, Keypair, Transaction } from "@stellar/stellar-sdk";
import {
  buildNativePaymentOperation,
  matchesNativePayout,
  parseSignedTransaction,
} from "./payment-xdr";

const DESTINATION = Keypair.random().publicKey();
const AMOUNT = "10.0000000";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

describe("parseSignedTransaction", () => {
  it("returns null for garbage input", () => {
    expect(
      parseSignedTransaction("not-valid-xdr", NETWORK_PASSPHRASE)
    ).toBeNull();
  });
});

describe("matchesNativePayout", () => {
  type Operation = Transaction["operations"][number];

  it("returns true for a matching native payment operation", () => {
    const op = {
      type: "payment" as const,
      destination: DESTINATION,
      asset: Asset.native(),
      amount: AMOUNT,
    } as Operation;

    expect(matchesNativePayout(op, DESTINATION, AMOUNT)).toBe(true);
  });

  it("returns true for a matching createAccount operation", () => {
    const op = {
      type: "createAccount" as const,
      destination: DESTINATION,
      startingBalance: AMOUNT,
    } as Operation;

    expect(matchesNativePayout(op, DESTINATION, AMOUNT)).toBe(true);
  });

  it("returns false when the amount does not match", () => {
    const op = {
      type: "payment" as const,
      destination: DESTINATION,
      asset: Asset.native(),
      amount: "9.9999999",
    } as Operation;

    expect(matchesNativePayout(op, DESTINATION, AMOUNT)).toBe(false);
  });

  it("returns false when the destination does not match", () => {
    const op = {
      type: "payment" as const,
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: AMOUNT,
    } as Operation;

    expect(matchesNativePayout(op, DESTINATION, AMOUNT)).toBe(false);
  });
});

describe("buildNativePaymentOperation", () => {
  it("builds a native payment when createAccount is false", () => {
    const op = buildNativePaymentOperation({
      destination: DESTINATION,
      amount: AMOUNT,
      createAccount: false,
    });

    expect(op.body().switch().name).toBe("payment");
  });

  it("builds a createAccount operation when createAccount is true", () => {
    const op = buildNativePaymentOperation({
      destination: DESTINATION,
      amount: AMOUNT,
      createAccount: true,
    });

    expect(op.body().switch().name).toBe("createAccount");
  });
});
