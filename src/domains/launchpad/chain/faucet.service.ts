import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  Operation,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { LaunchpadErrorCode } from "../launchpad.types";
import { LaunchpadChainService } from "./chain.service";

export const FAUCET_MAX_AMOUNT = 10_000;
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
/** Payouts per address per window. */
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Testnet only, and only for a Neko-issued test asset: pays it from the issuer
 * account. With Circle's USDC there is no issuer key, and people use Circle's
 * faucet instead.
 */
@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly chain: LaunchpadChainService) {}

  async payUsdc(address: string, amount: number): Promise<{ tx_hash: string }> {
    const destination = address.trim();
    if (!StrKey.isValidEd25519PublicKey(destination)) {
      throw new BadRequestException({
        message: "address must be a G... account",
      });
    }
    const p = await this.chain.platform();
    const issuer = p.usdcIssuer;
    if (!issuer) {
      throw new ConflictException({
        code: LaunchpadErrorCode.FAUCET_UNAVAILABLE,
        message: `Neko can't mint ${p.usdcAsset.getCode()}; get test funds at ${CIRCLE_FAUCET_URL}.`,
      });
    }
    this.takeSlot(destination);

    if (!(await this.chain.hasUsdcTrustline(destination))) {
      throw new ConflictException({
        code: LaunchpadErrorCode.TRUSTLINE_MISSING,
        message: `Open a ${p.usdcAsset.getCode()} trustline first.`,
      });
    }

    const source = await p.horizon.loadAccount(issuer.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: p.passphrase,
    })
      .addOperation(
        Operation.payment({
          destination,
          asset: p.usdcAsset,
          amount: amount.toFixed(7),
        })
      )
      .setTimeout(60)
      .build();
    tx.sign(issuer);

    try {
      const result = await p.horizon.submitTransaction(tx);
      this.logger.log({
        event: "launchpad_faucet_paid",
        destination,
        amount,
        tx: result.hash,
      });
      return { tx_hash: result.hash };
    } catch (error) {
      this.logger.warn({
        event: "launchpad_faucet_failed",
        destination,
        error,
      });
      throw new BadGatewayException({
        code: LaunchpadErrorCode.CHAIN_CALL_FAILED,
        message: "The test USDC payment did not go through.",
      });
    }
  }

  private takeSlot(address: string): void {
    const now = Date.now();
    const hits = (this.recent.get(address) ?? []).filter(
      (t) => now - t < WINDOW_MS
    );
    if (hits.length >= LIMIT) {
      throw new HttpException(
        { code: LaunchpadErrorCode.FAUCET_RATE_LIMITED },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    hits.push(now);
    this.recent.set(address, hits);
  }
}
