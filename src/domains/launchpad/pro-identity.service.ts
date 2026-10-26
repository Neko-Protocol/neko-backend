import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Address,
  BASE_FEE,
  Contract,
  hash,
  Keypair,
  Networks,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
  type xdr as Xdr,
} from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";

/**
 * Neko Pro vaults live on testnet, from
 * neko-tokenization-hackmeridian/deployments/testnet.json.
 */
const DEFAULTS = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  identityRegistry: "CDVJ7VI3QWP7CC7SLZ3BVXDOOSAZBNKQNFK7HU5CX2EZCOC2I34ELROV",
  claimIssuer: "CBYUESUTVUB4NV7PV63DYZYVK2DUIWASUKK55RBG7BVQLOZ2YCEJ76T4",
  // rwa_identity_example.wasm, already installed on testnet.
  identityWasmHash:
    "3b406019c6b585b692c06dfe69d961eb3403af5d558434670151a82d108894b1",
} as const;

/** Topics the identity verifier requires (claim_topics_and_issuers). */
const CLAIM_TOPICS = [1, 2] as const;
/** The Ed25519 claim scheme the claim issuer validates. */
const CLAIM_SCHEME = 101;
const CLAIM_VALID_DAYS = 365;
/** ISO 3166-1 numeric; 188 is Costa Rica. */
const DEFAULT_COUNTRY = 188;

/**
 * Gives a wallet that passed Neko Pro KYC/KYB (or the demo skip) a verified
 * on-chain identity, so the vault tokens' identity check lets it hold them.
 *
 * Mirrors contracts/scripts/onboard-wallet.sh: the manager, acting as the KYC
 * provider, deploys an identity contract it owns, attaches claims signed by
 * the trusted claim issuer's key, and registers the wallet with its country
 * in the shared identity registry. No personal data goes on-chain.
 */
@Injectable()
export class ProIdentityService {
  private readonly logger = new Logger(ProIdentityService.name);
  private readonly registered = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private server?: rpc.Server;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.managerSecret && this.claimSigningKey);
  }

  /** Registers `wallet` unless it already is. Concurrent calls share one run. */
  ensureRegistered(wallet: string): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn({ event: "pro_identity_not_configured", wallet });
      return Promise.resolve();
    }
    if (this.registered.has(wallet)) return Promise.resolve();

    let run = this.inFlight.get(wallet);
    if (!run) {
      run = this.register(wallet).finally(() => this.inFlight.delete(wallet));
      this.inFlight.set(wallet, run);
    }
    return run;
  }

  private async register(wallet: string): Promise<void> {
    if (await this.hasIdentity(wallet)) {
      this.registered.add(wallet);
      return;
    }

    const manager = Keypair.fromSecret(this.managerSecret!);
    const owner = new Address(manager.publicKey());

    const identity = scValToNative(
      await this.submit(
        Operation.createCustomContract({
          address: owner,
          wasmHash: Buffer.from(this.identityWasmHash, "hex"),
          salt: randomBytes(32),
          constructorArgs: [owner.toScVal()],
        })
      )
    ) as string;

    const identityContract = new Contract(identity);
    for (const topic of CLAIM_TOPICS) {
      const { data, signature } = this.signClaim(identity, topic);
      await this.submit(
        identityContract.call(
          "add_claim",
          xdr.ScVal.scvU32(topic),
          xdr.ScVal.scvU32(CLAIM_SCHEME),
          new Address(this.claimIssuer).toScVal(),
          xdr.ScVal.scvBytes(signature),
          xdr.ScVal.scvBytes(data),
          xdr.ScVal.scvString(`https://neko.example/claims/${wallet}/${topic}`)
        )
      );
    }

    await this.submit(
      new Contract(this.identityRegistry).call(
        "add_identity",
        new Address(wallet).toScVal(),
        new Address(identity).toScVal(),
        xdr.ScVal.scvVec([countryProfile(DEFAULT_COUNTRY)]),
        owner.toScVal()
      )
    );

    this.registered.add(wallet);
    this.logger.log({ event: "pro_identity_registered", wallet, identity });
  }

  /** `stored_identity` panics with IdentityNotFound when there is none. */
  private async hasIdentity(wallet: string): Promise<boolean> {
    const manager = Keypair.fromSecret(this.managerSecret!);
    const source = await this.rpc().getAccount(manager.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(this.identityRegistry).call(
          "stored_identity",
          new Address(wallet).toScVal()
        )
      )
      .setTimeout(30)
      .build();
    const sim = await this.rpc().simulateTransaction(tx);
    return !rpc.Api.isSimulationError(sim);
  }

  /**
   * Same message and layout as contracts/tools/sign-claim: the claim issuer
   * checks `sig_data = public_key || ed25519(message)` over
   * `0x01 || network_id || issuer || identity || topic || nonce || data`.
   */
  private signClaim(identity: string, topic: number) {
    const signer = Keypair.fromRawEd25519Seed(
      Buffer.from(this.claimSigningKey!, "hex")
    );
    const createdAt = BigInt(Math.floor(Date.now() / 1000));
    const data = Buffer.alloc(16);
    data.writeBigUInt64BE(createdAt, 0);
    data.writeBigUInt64BE(createdAt + BigInt(CLAIM_VALID_DAYS * 86_400), 8);

    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const message = Buffer.concat([
      Buffer.from([0x01]),
      hash(Buffer.from(Networks.TESTNET)),
      new Address(this.claimIssuer).toScVal().toXDR(),
      new Address(identity).toScVal().toXDR(),
      u32(topic),
      // A fresh identity has no claims yet, so its nonce is 0.
      u32(0),
      data,
    ]);
    const signature = Buffer.concat([
      signer.rawPublicKey(),
      signer.sign(message),
    ]);
    return { data, signature };
  }

  /** Simulates, signs as the manager, submits and waits; returns the result. */
  private async submit(op: Xdr.Operation): Promise<Xdr.ScVal> {
    const manager = Keypair.fromSecret(this.managerSecret!);
    const source = await this.rpc().getAccount(manager.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const prepared = await this.rpc().prepareTransaction(tx);
    prepared.sign(manager);
    const sent = await this.rpc().sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(`pro identity tx rejected: ${sent.hash}`);
    }
    const result = await this.rpc().pollTransaction(sent.hash, {
      attempts: 30,
    });
    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`pro identity tx ${result.status}: ${sent.hash}`);
    }
    return result.returnValue ?? xdr.ScVal.scvVoid();
  }

  private rpc(): rpc.Server {
    this.server ??= new rpc.Server(
      this.env("PRO_STELLAR_RPC_URL") ?? DEFAULTS.rpcUrl
    );
    return this.server;
  }

  private env(key: string): string | undefined {
    return this.config.get<string>(key)?.trim() || undefined;
  }

  private get managerSecret() {
    return this.env("PRO_MANAGER_SECRET");
  }

  private get claimSigningKey() {
    return this.env("PRO_CLAIM_SIGNING_KEY");
  }

  private get identityRegistry() {
    return this.env("PRO_IDENTITY_REGISTRY") ?? DEFAULTS.identityRegistry;
  }

  private get claimIssuer() {
    return this.env("PRO_CLAIM_ISSUER") ?? DEFAULTS.claimIssuer;
  }

  private get identityWasmHash() {
    return this.env("PRO_IDENTITY_WASM_HASH") ?? DEFAULTS.identityWasmHash;
  }
}

/** `CountryData { country: Individual(Residence(code)), metadata: None }`. */
function countryProfile(code: number): Xdr.ScVal {
  const sym = (s: string) => xdr.ScVal.scvSymbol(s);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: sym("country"),
      val: xdr.ScVal.scvVec([
        sym("Individual"),
        xdr.ScVal.scvVec([sym("Residence"), xdr.ScVal.scvU32(code)]),
      ]),
    }),
    new xdr.ScMapEntry({ key: sym("metadata"), val: xdr.ScVal.scvVoid() }),
  ]);
}
