import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/**
 * Thin Soroban client for the Launchpad: simulated reads and manager- or
 * admin-signed writes against the testnet contracts. Mirrors the read helpers
 * in neko-tokenization-hackmeridian/packages/stellar/src/contracts.ts.
 */

// ------------------------------------------------------------------ Arguments

export const arg = {
  address: (value: string): xdr.ScVal => Address.fromString(value).toScVal(),
  u32: (value: number): xdr.ScVal => nativeToScVal(value, { type: "u32" }),
  u64: (value: number | bigint): xdr.ScVal =>
    nativeToScVal(BigInt(value), { type: "u64" }),
  i128: (value: bigint): xdr.ScVal => nativeToScVal(value, { type: "i128" }),
  bool: (value: boolean): xdr.ScVal => nativeToScVal(value),
  string: (value: string): xdr.ScVal =>
    nativeToScVal(value, { type: "string" }),
  symbol: (value: string): xdr.ScVal => xdr.ScVal.scvSymbol(value),
  bytes: (value: Buffer): xdr.ScVal => nativeToScVal(value),
  /** A `BytesN<32>` given as 64 hex characters. */
  bytes32: (hex: string): xdr.ScVal => nativeToScVal(Buffer.from(hex, "hex")),
  vec: (values: xdr.ScVal[]): xdr.ScVal => xdr.ScVal.scvVec(values),
  void: (): xdr.ScVal => xdr.ScVal.scvVoid(),
  /** A `#[contracttype]` struct: an ScMap whose symbol keys are sorted. */
  struct: (fields: Record<string, xdr.ScVal>): xdr.ScVal =>
    xdr.ScVal.scvMap(
      Object.keys(fields)
        .sort()
        .map(
          (key) =>
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol(key),
              val: fields[key],
            })
        )
    ),
};

// --------------------------------------------------------------------- Errors

export class ChainCallError extends Error {
  constructor(
    message: string,
    /** The contract's own error code, when the failure was a contract panic. */
    readonly code: number | null
  ) {
    super(message);
    this.name = "ChainCallError";
  }
}

/** Pull `Error(Contract, #n)` out of a simulation or submission failure. */
export function contractErrorCode(message: string): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(message);
  return match ? Number(match[1]) : null;
}

function toChainError(error: unknown): ChainCallError {
  if (error instanceof ChainCallError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ChainCallError(message, contractErrorCode(message));
}

/** A unit enum variant comes back as `["Funding"]`; take the name. */
export function variant(value: unknown): string {
  return Array.isArray(value) ? String(value[0]) : String(value);
}

// --------------------------------------------------------------------- Client

export interface SentTx<T = unknown> {
  hash: string;
  result: T;
}

const POLL_ATTEMPTS = 30;

export class SorobanClient {
  constructor(
    readonly server: rpc.Server,
    readonly passphrase: string,
    /** Any funded account; simulations are never submitted. */
    private readonly readSource: string
  ) {}

  /** Simulate a view call and decode its result to plain JavaScript. */
  async read<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.readSource, "0"), {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new ChainCallError(sim.error, contractErrorCode(sim.error));
    }
    if (!sim.result) {
      throw new ChainCallError(`${method} returned nothing`, null);
    }
    return scValToNative(sim.result.retval) as T;
  }

  /** Call a contract method, signed and paid for by `signer`. */
  invoke<T = unknown>(
    signer: Keypair,
    contractId: string,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<SentTx<T>> {
    return this.submit<T>(
      signer,
      new Contract(contractId).call(method, ...args)
    );
  }

  /** Simulate, sign, send and wait for one Soroban operation. */
  async submit<T = unknown>(
    signer: Keypair,
    operation: xdr.Operation
  ): Promise<SentTx<T>> {
    try {
      const source = await this.server.getAccount(signer.publicKey());
      const built = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.passphrase,
      })
        .addOperation(operation)
        .setTimeout(60)
        .build();

      // Fails with the simulation's error, contract code included, before
      // anything is sent.
      const prepared = await this.server.prepareTransaction(built);
      prepared.sign(signer);

      const sent = await this.server.sendTransaction(prepared);
      if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
        throw new ChainCallError(
          `submit ${sent.status}: ${sent.errorResult?.result().switch().name ?? "unknown"}`,
          null
        );
      }

      const final = await this.server.pollTransaction(sent.hash, {
        attempts: POLL_ATTEMPTS,
        sleepStrategy: () => 2000,
      });
      if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new ChainCallError(
          `transaction ${sent.hash} ${final.status}`,
          null
        );
      }
      return {
        hash: sent.hash,
        result: (final.returnValue
          ? scValToNative(final.returnValue)
          : undefined) as T,
      };
    } catch (error) {
      throw toChainError(error);
    }
  }
}
