import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { PrivyClient, type LinkedAccount } from "@privy-io/node";
import type {
  PrivyPrincipal,
  PrivyStellarWallet,
  PrivyUserProfile,
} from "./privy.types";

/**
 * Thin wrapper over the official Privy Node SDK. Access tokens are verified by the SDK (ES256, issuer privy.io, audience = app id).
 */
@Injectable()
export class PrivyService {
  private readonly logger = new Logger(PrivyService.name);
  private client?: PrivyClient;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  private get appId(): string | undefined {
    return this.config.get<string>("PRIVY_APP_ID")?.trim() || undefined;
  }

  private get appSecret(): string | undefined {
    return this.config.get<string>("PRIVY_APP_SECRET")?.trim() || undefined;
  }

  private get verificationKeyPem(): string | undefined {
    const raw = this.config.get<string>("PRIVY_VERIFICATION_KEY")?.trim();
    return raw ? raw.replace(/\\n/g, "\n") : undefined;
  }

  private privy(): PrivyClient {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException({
        code: ErrorCode.PRIVY_NOT_CONFIGURED,
      });
    }
    this.client ??= new PrivyClient({
      appId: this.appId!,
      appSecret: this.appSecret!,
      jwtVerificationKey: this.verificationKeyPem,
    });
    return this.client;
  }

  async verifyAccessToken(token: string): Promise<PrivyPrincipal> {
    const client = this.privy();
    try {
      const claims = await client.utils().auth().verifyAccessToken(token);
      return { userId: claims.user_id, sessionId: claims.session_id };
    } catch (err) {
      this.logger.debug({
        event: "privy_token_rejected",
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new UnauthorizedException({ code: ErrorCode.PRIVY_TOKEN_INVALID });
    }
  }

  async getUser(userId: string): Promise<PrivyUserProfile> {
    const client = this.privy();
    try {
      const user = await client.users()._get(userId);
      return toProfile(user.id, user.linked_accounts);
    } catch (err) {
      this.logger.error({
        event: "privy_get_user_failed",
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({
        code: ErrorCode.PRIVY_UNAVAILABLE,
      });
    }
  }
}

export function toProfile(
  userId: string,
  linked: LinkedAccount[]
): PrivyUserProfile {
  let email: string | null = null;
  const stellarWallets: PrivyStellarWallet[] = [];

  for (const account of linked) {
    if (account.type === "email") {
      email ??= account.address;
    } else if (
      (account.type === "google_oauth" || account.type === "apple_oauth") &&
      account.email
    ) {
      email ??= account.email;
    } else if (
      account.type === "wallet" &&
      "chain_type" in account &&
      account.chain_type === "stellar" &&
      account.wallet_client_type === "privy"
    ) {
      stellarWallets.push({
        address: account.address,
        walletId: "id" in account ? (account.id ?? null) : null,
      });
    }
  }

  return { userId, email: email?.toLowerCase() ?? null, stellarWallets };
}
