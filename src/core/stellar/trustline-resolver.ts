import { Injectable, Logger } from "@nestjs/common";
import {
  Account,
  Asset,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { StellarRpcService } from "./stellar-rpc.service";

export const TRUSTLINES_REQUIRED = "TRUSTLINES_REQUIRED";

const TRUSTLINE_MISSING = "trustline entry is missing for account";

@Injectable()
export class TrustlineResolver {
  private readonly logger = new Logger(TrustlineResolver.name);
  private readonly assets = new Map<string, Asset | null>();

  constructor(private readonly stellar: StellarRpcService) {}

  missingTrustlineContracts(
    sim: rpc.Api.SimulateTransactionResponse,
    account: string
  ): string[] {
    if (!rpc.Api.isSimulationError(sim)) return [];
    const contracts = new Set<string>();
    for (const event of sim.events ?? []) {
      const contractId = trustlineMissingContract(event, account);
      if (contractId) contracts.add(contractId);
    }
    return [...contracts];
  }

  async assetForContract(contractId: string): Promise<Asset | null> {
    if (this.assets.has(contractId)) return this.assets.get(contractId)!;

    let asset: Asset | null = null;
    try {
      const passphrase = this.stellar.getNetworkPassphrase();
      const source = new Account(Keypair.random().publicKey(), "0");
      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: passphrase,
      })
        .addOperation(new Contract(contractId).call("name"))
        .setTimeout(30)
        .build();
      const sim = await this.stellar.rpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const name = scValToNative(sim.result.retval) as unknown;
        const [code, issuer] = typeof name === "string" ? name.split(":") : [];
        if (code && issuer && StrKey.isValidEd25519PublicKey(issuer)) {
          const candidate = new Asset(code, issuer);
          if (candidate.contractId(passphrase) === contractId) {
            asset = candidate;
          }
        }
      }
    } catch (err) {
      this.logger.warn({
        event: "sac_resolve_failed",
        contractId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    this.assets.set(contractId, asset);
    return asset;
  }
}

function trustlineMissingContract(
  event: xdr.DiagnosticEvent,
  account: string
): string | null {
  const inner = event.event();
  const id = inner.contractId();
  if (!id) return null;

  const body = inner.body().v0();
  const [topic] = body.topics();
  if (!topic || topic.switch().name !== "scvSymbol") return null;
  if (topic.sym().toString() !== "error") return null;

  let data: unknown;
  try {
    data = scValToNative(body.data());
  } catch {
    return null;
  }
  if (
    !Array.isArray(data) ||
    data[0] !== TRUSTLINE_MISSING ||
    data[1] !== account
  ) {
    return null;
  }
  return StrKey.encodeContract(id as unknown as Buffer);
}
