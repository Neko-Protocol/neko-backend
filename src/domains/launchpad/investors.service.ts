import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { StrKey } from "@stellar/stellar-sdk";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  LAUNCHPAD_NETWORK,
  LaunchpadErrorCode,
  toInvestorView,
  type InvestorRow,
  type InvestorView,
} from "./launchpad.types";
import { VerificationsService } from "./verifications.service";

const TABLE = "launchpad_investors";

/**
 * Neko Pro investors: a wallet whitelisted by an approved KYC/KYB
 * verification. Unlike Launchpad accounts there is no Privy user or embedded
 * wallet; the investor keeps the wallet they connected to Neko Web.
 */
@Injectable()
export class InvestorsService {
  private readonly logger = new Logger(InvestorsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly verifications: VerificationsService
  ) {}

  async create(
    verificationId: string,
    claimToken: string | undefined,
    walletAddress: string
  ): Promise<InvestorView> {
    const wallet = this.assertWallet(walletAddress);
    const verification = await this.verifications.authorize(
      verificationId,
      claimToken
    );
    if (verification.status !== "approved") {
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_NOT_APPROVED,
        message: `Verification is ${verification.status}`,
      });
    }

    const bound = await this.findBy("verification_id", verification.id);
    if (bound) {
      if (bound.wallet_address !== wallet) {
        throw new ConflictException({
          code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
        });
      }
      return toInvestorView(bound, verification);
    }
    if (verification.claimed_at) {
      // Already claimed by a Launchpad account.
      throw new ConflictException({
        code: LaunchpadErrorCode.VERIFICATION_ALREADY_CLAIMED,
      });
    }
    if (await this.findBy("wallet_address", wallet)) {
      throw new ConflictException({
        code: LaunchpadErrorCode.WALLET_ALREADY_VERIFIED,
      });
    }

    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert({
        wallet_address: wallet,
        verification_id: verification.id,
        network: LAUNCHPAD_NETWORK,
      })
      .select("*")
      .single();
    if (error || !data) throw this.dbError("insert", error);

    const claimed = await this.verifications.markClaimed(verification.id);
    return toInvestorView(data as InvestorRow, claimed);
  }

  async get(walletAddress: string): Promise<InvestorView> {
    const investor = await this.findBy(
      "wallet_address",
      this.assertWallet(walletAddress)
    );
    if (!investor) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.INVESTOR_NOT_FOUND,
      });
    }
    const verification = await this.verifications.find(
      investor.verification_id
    );
    if (!verification) throw this.dbError("verification_lookup", null);
    return toInvestorView(investor, verification);
  }

  private assertWallet(address: string): string {
    const wallet = address.trim();
    if (!StrKey.isValidEd25519PublicKey(wallet)) {
      throw new BadRequestException({ code: ErrorCode.INVALID_WALLET });
    }
    return wallet;
  }

  private async findBy(
    column: "verification_id" | "wallet_address",
    value: string
  ): Promise<InvestorRow | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select("*")
      .eq(column, value)
      .maybeSingle();
    if (error) throw this.dbError("lookup", error);
    return (data as InvestorRow | null) ?? null;
  }

  private dbError(op: string, error: unknown) {
    this.logger.error({ event: "launchpad_investor_db_error", op, error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}
