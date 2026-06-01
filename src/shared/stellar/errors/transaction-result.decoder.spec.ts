import { xdr } from "@stellar/stellar-sdk";
import {
  decodeTransactionResultXdr,
  formatDecodedResult,
} from "./transaction-result.decoder";

// Real mainnet failure: txFailed → invokeHostFunctionTrapped
const TRAPPED_XDR_BASE64 = "AAAAAAAAhYT/////AAAAAQAAAAAAAAAY/////gAAAAA=";

describe("decodeTransactionResultXdr", () => {
  it("returns null for null input", () => {
    expect(decodeTransactionResultXdr(null)).toBeNull();
    expect(decodeTransactionResultXdr(undefined)).toBeNull();
  });

  it("decodes a real failed invokeHostFunction result", () => {
    const r = xdr.TransactionResult.fromXDR(TRAPPED_XDR_BASE64, "base64");
    const decoded = decodeTransactionResultXdr(r);
    expect(decoded).not.toBeNull();
    expect(decoded?.txCode).toBe("txFailed");
    expect(decoded?.opCodes).toEqual([
      "invokeHostFunction:invokeHostFunctionTrapped",
    ]);
  });

  it("returns null and does not throw on malformed input", () => {
    const broken = {
      result: () => {
        throw new Error("nope");
      },
    } as unknown as xdr.TransactionResult;
    expect(decodeTransactionResultXdr(broken)).toBeNull();
  });
});

describe("formatDecodedResult", () => {
  it("formats txCode alone when there are no op codes", () => {
    expect(formatDecodedResult({ txCode: "txBadSeq", opCodes: [] })).toBe(
      "txBadSeq"
    );
  });

  it("joins op codes with a comma", () => {
    expect(
      formatDecodedResult({
        txCode: "txFailed",
        opCodes: ["invokeHostFunction:invokeHostFunctionTrapped"],
      })
    ).toBe("txFailed: invokeHostFunction:invokeHostFunctionTrapped");
    expect(
      formatDecodedResult({
        txCode: "txFailed",
        opCodes: ["payment:opNoTrust", "manageOffer:opSuccess"],
      })
    ).toBe("txFailed: payment:opNoTrust, manageOffer:opSuccess");
  });
});
