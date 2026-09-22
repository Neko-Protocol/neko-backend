import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Client as DefindexVaultClient } from "@neko-protocol/defindex-vault";
import { errorToString } from "./helpers";
import { sendTx } from "./tx";
import type { AssembledTxLike, FeesSummary, TxResult } from "./types";

interface FeesContext {
  client: DefindexVaultClient;
  keypair: Keypair;
  server: rpc.Server;
  networkPassphrase: string;
  hasBudget: () => boolean;
}

export async function collectFees(ctx: FeesContext): Promise<FeesSummary> {
  const { client, keypair, server, networkPassphrase, hasBudget } = ctx;
  const results: Array<TxResult & { step: string }> = [];

  if (!hasBudget()) {
    results.push({
      step: "report",
      hash: "",
      status: "skipped_timeout_budget",
    });
    return { attempted: true, results, feesCollected: false };
  }

  try {
    const reportTx = await client.report();
    const r = await sendTx(
      reportTx as AssembledTxLike,
      keypair,
      server,
      networkPassphrase
    );
    results.push({ step: "report", ...r });
    if (r.status !== "SUCCESS") {
      return { attempted: true, results, feesCollected: false };
    }
  } catch (e) {
    results.push({
      step: "report",
      hash: "",
      status: `error: ${errorToString(e)}`,
    });
    return { attempted: true, results, feesCollected: false };
  }

  if (!hasBudget()) {
    results.push({
      step: "lock_fees",
      hash: "",
      status: "skipped_timeout_budget",
    });
    return { attempted: true, results, feesCollected: false };
  }

  try {
    const lockTx = await client.lock_fees({ new_fee_bps: undefined });
    const r = await sendTx(
      lockTx as AssembledTxLike,
      keypair,
      server,
      networkPassphrase
    );
    results.push({ step: "lock_fees", ...r });
    if (r.status !== "SUCCESS") {
      return { attempted: true, results, feesCollected: false };
    }
  } catch (e) {
    results.push({
      step: "lock_fees",
      hash: "",
      status: `error: ${errorToString(e)}`,
    });
    return { attempted: true, results, feesCollected: false };
  }

  if (!hasBudget()) {
    results.push({
      step: "distribute_fees",
      hash: "",
      status: "skipped_timeout_budget",
    });
    return { attempted: true, results, feesCollected: false };
  }

  try {
    const distTx = await client.distribute_fees({
      caller: keypair.publicKey(),
    });
    const r = await sendTx(
      distTx as AssembledTxLike,
      keypair,
      server,
      networkPassphrase
    );
    results.push({ step: "distribute_fees", ...r });
    return {
      attempted: true,
      results,
      feesCollected: r.status === "SUCCESS",
    };
  } catch (e) {
    results.push({
      step: "distribute_fees",
      hash: "",
      status: `error: ${errorToString(e)}`,
    });
    return { attempted: true, results, feesCollected: false };
  }
}
