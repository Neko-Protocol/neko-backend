import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { Client as DefindexVaultClient } from "@neko/defindex-vault";
import type { ManagedFundsEntryLike } from "@neko/keeper";
import { errorToString, unwrapSdkResult } from "./helpers";
import type { AssembledTxLike, TxResult } from "./types";

export async function fetchManagedFunds(
  client: DefindexVaultClient
): Promise<ManagedFundsEntryLike[]> {
  const fundsTx = await client.fetch_total_managed_funds({ simulate: true });
  return unwrapSdkResult(fundsTx.result) as ManagedFundsEntryLike[];
}

export async function waitForTx(
  server: rpc.Server,
  hash: string
): Promise<"SUCCESS" | "FAILED" | "TIMEOUT"> {
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await server.getTransaction(hash);
    if (status.status === "SUCCESS") return "SUCCESS";
    if (status.status === "FAILED") return "FAILED";
  }
  return "TIMEOUT";
}

export async function sendTx(
  assembledTx: AssembledTxLike,
  keypair: Keypair,
  server: rpc.Server,
  networkPassphrase: string
): Promise<TxResult> {
  if (assembledTx.simulation?.error) {
    return {
      hash: "",
      status: `sim_error: ${errorToString(assembledTx.simulation.error)}`,
    };
  }

  const builtTx = TransactionBuilder.fromXDR(
    assembledTx.toXDR(),
    networkPassphrase
  );
  const preparedTx = await server.prepareTransaction(builtTx);
  preparedTx.sign(keypair);
  const sendResult = await server.sendTransaction(preparedTx);
  if (sendResult.status !== "PENDING") {
    // The keeper runs unattended on a cron, so "submit_error" alone leaves
    // nothing to diagnose from. Surface the network's own reason —
    // txBadSeq, txInsufficientFee and so on — which is the difference
    // between knowing what happened and not.
    return {
      hash: sendResult.hash ?? "",
      status: `submit_error: ${describeSubmitFailure(sendResult)}`,
    };
  }
  const finalStatus = await waitForTx(server, sendResult.hash);
  return { hash: sendResult.hash, status: finalStatus };
}

/**
 * Extracts a readable reason from a rejected submission. The SDK exposes it
 * either as a decoded errorResult or as raw XDR depending on the response, and
 * neither is typed, so both are probed defensively — a failure to explain the
 * failure must not itself throw.
 */
function describeSubmitFailure(sendResult: unknown): string {
  const result = sendResult as {
    status?: unknown;
    errorResult?: { result?: () => { switch?: () => { name?: string } } };
    errorResultXdr?: unknown;
  };

  let reason: string | null = null;
  try {
    reason = result.errorResult?.result?.()?.switch?.()?.name ?? null;
  } catch {
    reason = null;
  }
  if (!reason && typeof result.errorResultXdr === "string") {
    reason = result.errorResultXdr;
  }

  return JSON.stringify({ status: result.status ?? "unknown", reason });
}
