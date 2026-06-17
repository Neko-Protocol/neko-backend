/**
 * Reusable native-XLM payout primitives for building and validating Stellar transactions.
 * Pure helpers with no NestJS or domain coupling — callers map errors to HTTP exceptions.
 */

import {
  Asset,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export function parseSignedTransaction(
  signedXdr: string,
  networkPassphrase: string
): Transaction | null {
  try {
    const parsed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    if (!(parsed instanceof Transaction)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function matchesNativePayout(
  op: Transaction["operations"][number],
  destination: string,
  expectedAmount: string
): boolean {
  return (
    (op.type === "payment" &&
      op.destination === destination &&
      op.asset.isNative() &&
      Number(op.amount).toFixed(7) === expectedAmount) ||
    (op.type === "createAccount" &&
      op.destination === destination &&
      Number(op.startingBalance).toFixed(7) === expectedAmount)
  );
}

export function buildNativePaymentOperation(params: {
  destination: string;
  amount: string;
  createAccount: boolean;
}): xdr.Operation {
  const { destination, amount, createAccount } = params;
  if (createAccount) {
    return Operation.createAccount({ destination, startingBalance: amount });
  }
  return Operation.payment({
    destination,
    asset: Asset.native(),
    amount,
  });
}
