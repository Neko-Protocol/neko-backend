import {
  Address,
  Asset,
  Keypair,
  Networks,
  StrKey,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { StellarRpcService } from "./stellar-rpc.service";
import { TrustlineResolver } from "./trustline-resolver";

const PASSPHRASE = Networks.PUBLIC;
const USER = Keypair.random().publicKey();
const CETES = new Asset("CETES", Keypair.random().publicKey());
const CETES_SAC = CETES.contractId(PASSPHRASE);

function trustlineMissingEvent(contractId: string, account: string) {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: StrKey.decodeContract(contractId) as unknown as xdr.Hash,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [
            xdr.ScVal.scvSymbol("error"),
            xdr.ScVal.scvError(xdr.ScError.sceContract(13)),
          ],
          data: xdr.ScVal.scvVec([
            xdr.ScVal.scvString("trustline entry is missing for account"),
            new Address(account).toScVal(),
          ]),
        })
      ),
    }),
  });
}

function simError(events: xdr.DiagnosticEvent[]) {
  return {
    error: "HostError: Error(Contract, #13)",
    events,
    id: "1",
    latestLedger: 1,
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

function resolver(nameResult?: string) {
  const simulateTransaction = jest.fn(async () =>
    nameResult === undefined
      ? simError([])
      : ({
          id: "1",
          latestLedger: 1,
          events: [],
          transactionData: "",
          minResourceFee: "0",
          result: { auth: [], retval: nativeToScVal(nameResult) },
        } as unknown as rpc.Api.SimulateTransactionResponse)
  );
  const stellar = {
    getNetworkPassphrase: () => PASSPHRASE,
    rpc: { simulateTransaction },
  } as unknown as StellarRpcService;
  return { resolver: new TrustlineResolver(stellar), simulateTransaction };
}

describe("TrustlineResolver", () => {
  it("finds the SAC that refused the account", () => {
    const { resolver: r } = resolver();
    const sim = simError([trustlineMissingEvent(CETES_SAC, USER)]);
    expect(r.missingTrustlineContracts(sim, USER)).toEqual([CETES_SAC]);
  });

  it("ignores a missing trustline of another account", () => {
    const { resolver: r } = resolver();
    const other = Keypair.random().publicKey();
    const sim = simError([trustlineMissingEvent(CETES_SAC, other)]);
    expect(r.missingTrustlineContracts(sim, USER)).toEqual([]);
  });

  it("resolves a SAC to its classic asset, and caches it", async () => {
    const { resolver: r, simulateTransaction } = resolver(
      `CETES:${CETES.getIssuer()}`
    );
    const asset = await r.assetForContract(CETES_SAC);
    expect(asset?.getCode()).toBe("CETES");
    expect(asset?.getIssuer()).toBe(CETES.getIssuer());
    await r.assetForContract(CETES_SAC);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a contract whose name is not its own asset", async () => {
    const { resolver: r } = resolver(`CETES:${CETES.getIssuer()}`);
    const impostor = StrKey.encodeContract(Buffer.alloc(32, 7));
    expect(await r.assetForContract(impostor)).toBeNull();
  });
});
