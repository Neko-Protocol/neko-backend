import { Injectable, Logger } from "@nestjs/common";
import {
  Address,
  Keypair,
  Operation,
  StrKey,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { LaunchpadChainService, type Platform } from "./chain.service";
import { ChainCallError, arg } from "./soroban";
import { sha256 } from "./terms";

/** stellar-tokens `IdentityRegistryStorageError::IdentityNotFound`. */
const IDENTITY_NOT_FOUND = 321;
/** Claim topics every holder of a Neko vault token must satisfy. */
const CLAIM_TOPICS = [1, 2] as const; // KYC, AML
/** ECDSA-style signature scheme id the claim issuer expects for Ed25519. */
const CLAIM_SCHEME = 101;
const CLAIM_VALID_SECONDS = 365n * 86_400n;

/**
 * Gives a verified wallet an on-chain identity so it can hold vault tokens:
 * the manager deploys an identity contract it owns, attaches signed KYC and
 * AML claims, and registers the wallet in the shared identity registry. The
 * verifier never checks who owns an identity, so the investor signs nothing.
 */
@Injectable()
export class OnchainIdentityService {
  private readonly logger = new Logger(OnchainIdentityService.name);

  constructor(private readonly chain: LaunchpadChainService) {}

  /**
   * Idempotent. Returns the identity contract; when the wallet is already
   * registered, the one the registry holds.
   */
  async register(
    wallet: string,
    countryAlpha2: string | null,
    existingIdentity: string | null
  ): Promise<string> {
    const p = await this.chain.platform();
    const stored = await this.storedIdentity(p, wallet);
    if (stored) return stored;

    const identity = existingIdentity ?? (await this.deployIdentity(p, wallet));
    for (const topic of CLAIM_TOPICS) {
      await this.addClaim(p, identity, wallet, topic);
    }
    await p.soroban.invoke(p.manager, p.identityRegistry, "add_identity", [
      arg.address(wallet),
      arg.address(identity),
      arg.vec([countryProfile(isoNumeric(countryAlpha2))]),
      arg.address(p.manager.publicKey()),
    ]);
    this.logger.log({
      event: "launchpad_investor_onchain",
      wallet,
      identity,
    });
    return identity;
  }

  private async storedIdentity(
    p: Platform,
    wallet: string
  ): Promise<string | null> {
    try {
      return await p.soroban.read<string>(
        p.identityRegistry,
        "stored_identity",
        [arg.address(wallet)]
      );
    } catch (error) {
      if (error instanceof ChainCallError && error.code === IDENTITY_NOT_FOUND)
        return null;
      throw error;
    }
  }

  private async deployIdentity(p: Platform, wallet: string): Promise<string> {
    const manager = p.manager.publicKey();
    const salt = sha256(wallet);
    const op = Operation.createCustomContract({
      address: Address.fromString(manager),
      wasmHash: Buffer.from(p.identityWasmHash, "hex"),
      salt,
      constructorArgs: [arg.address(manager)],
    });
    try {
      const sent = await p.soroban.submit<string>(p.manager, op);
      return sent.result;
    } catch (error) {
      // Deployed by an earlier attempt that failed later on: same salt, same
      // address.
      const address = contractAddress(p.passphrase, manager, salt);
      const exists = await p.soroban
        .read<string>(address, "get_owner")
        .then(() => true)
        .catch(() => false);
      if (exists) return address;
      throw error;
    }
  }

  private async addClaim(
    p: Platform,
    identity: string,
    wallet: string,
    topic: number
  ): Promise<void> {
    const { signature, data } = signClaim(
      p.claimSigningKey,
      p.passphrase,
      p.claimIssuer,
      identity,
      topic
    );
    await p.soroban.invoke(p.manager, identity, "add_claim", [
      arg.u32(topic),
      arg.u32(CLAIM_SCHEME),
      arg.address(p.claimIssuer),
      arg.bytes(signature),
      arg.bytes(data),
      arg.string(`${p.publicApiUrl}/claims/${wallet}/${topic}`),
    ]);
  }
}

/**
 * The claim message and signature, byte for byte as
 * contracts/tools/sign-claim/src/main.rs builds them.
 */
export function signClaim(
  seed: Buffer,
  passphrase: string,
  claimIssuer: string,
  identity: string,
  topic: number,
  now: Date = new Date()
): { signature: Buffer; data: Buffer } {
  const keypair = Keypair.fromRawEd25519Seed(seed);
  const created = BigInt(Math.floor(now.getTime() / 1000));
  const data = Buffer.concat([
    u64be(created),
    u64be(created + CLAIM_VALID_SECONDS),
  ]);
  const message = Buffer.concat([
    Buffer.from([1]),
    sha256(passphrase),
    Address.fromString(claimIssuer).toScVal().toXDR(),
    Address.fromString(identity).toScVal().toXDR(),
    u32be(topic),
    u32be(0), // nonce
    data,
  ]);
  return {
    signature: Buffer.concat([keypair.rawPublicKey(), keypair.sign(message)]),
    data,
  };
}

/** Individual / Residence / ISO 3166-1 numeric, as onboard-investor.sh encodes it. */
function countryProfile(numeric: number) {
  return arg.struct({
    country: arg.vec([
      arg.symbol("Individual"),
      arg.vec([arg.symbol("Residence"), arg.u32(numeric)]),
    ]),
    metadata: arg.void(),
  });
}

/** The countries the Launchpad serves; Costa Rica when unknown. */
const ISO_NUMERIC: Record<string, number> = {
  AR: 32,
  BR: 76,
  CA: 124,
  CL: 152,
  CO: 170,
  CR: 188,
  DO: 214,
  EC: 218,
  SV: 222,
  ES: 724,
  GT: 320,
  HN: 340,
  MX: 484,
  NI: 558,
  PA: 591,
  PE: 604,
  PY: 600,
  UY: 858,
  GB: 826,
  DE: 276,
  FR: 250,
  US: 840,
  VE: 862,
};

export function isoNumeric(alpha2: string | null): number {
  return ISO_NUMERIC[(alpha2 ?? "").toUpperCase()] ?? ISO_NUMERIC.CR;
}

function u64be(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value);
  return buf;
}

function u32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

/** The address `createCustomContract` deploys to, from deployer and salt. */
export function contractAddress(
  passphrase: string,
  deployer: string,
  salt: Buffer
): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(passphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(deployer).toScAddress(),
          salt,
        })
      ),
    })
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
