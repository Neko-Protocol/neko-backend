import { xdr } from "@stellar/stellar-sdk";

export interface DecodedTransactionResult {
  txCode: string;
  opCodes: string[];
}

export function decodeTransactionResultXdr(
  resultXdr: xdr.TransactionResult | undefined | null
): DecodedTransactionResult | null {
  if (!resultXdr) return null;
  try {
    const result = resultXdr.result();
    const txCode = result.switch().name;
    const opCodes: string[] = [];

    const collect =
      typeof (result as { results?: () => unknown }).results === "function"
        ? ((
            result as unknown as { results: () => unknown[] }
          ).results() as Array<unknown>)
        : [];

    for (const opRes of collect) {
      const tr = (opRes as { tr?: () => xdr.OperationResultTr | undefined }).tr;
      if (typeof tr !== "function") continue;
      const inner = tr.call(opRes);
      if (!inner) continue;
      const opName = inner.switch().name;
      if (opName === "invokeHostFunction") {
        opCodes.push(
          `invokeHostFunction:${inner.invokeHostFunctionResult().switch().name}`
        );
      } else {
        opCodes.push(opName);
      }
    }
    return { txCode, opCodes };
  } catch {
    return null;
  }
}

export function formatDecodedResult(d: DecodedTransactionResult): string {
  if (d.opCodes.length === 0) return d.txCode;
  return `${d.txCode}: ${d.opCodes.join(", ")}`;
}
