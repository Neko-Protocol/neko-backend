import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { APIError, PrivyClient, type LinkedAccount } from "@privy-io/node";
import {
  PrivyErrorCode,
  type PrivyPrincipal,
  type PrivyStellarWallet,
  type PrivyUserProfile,
} from "./privy.types";

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
        code: ErrorCode.NOT_CONFIGURED,
        message: "Privy is not configured",
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
      throw new UnauthorizedException({
        code: PrivyErrorCode.PRIVY_TOKEN_INVALID,
      });
    }
  }

  async getUser(userId: string): Promise<PrivyUserProfile> {
    const client = this.privy();
    try {
      const user = await client.users()._get(userId);
      return toProfile(user.id, user.linked_accounts);
    } catch (err) {
      throw this.unavailable("privy_get_user_failed", err);
    }
  }

  async ensureUserWithStellarWallet(
    email: string,
    metadata: Record<string, string | number | boolean> = {}
  ): Promise<PrivyUserProfile & { wallet: PrivyStellarWallet }> {
    const client = this.privy();
    const address = email.trim().toLowerCase();
    try {
      let profile = await this.findUserByEmail(client, address);
      if (!profile) {
        const created = await client.users().create({
          linked_accounts: [{ type: "email", address }],
          wallets: [{ chain_type: "stellar" }],
          custom_metadata: metadata,
        });
        profile = toProfile(created.id, created.linked_accounts);
      }
      if (profile.stellarWallets.length === 0) {
        const updated = await client
          .users()
          .pregenerateWallets(profile.userId, {
            wallets: [{ chain_type: "stellar" }],
          });
        profile = toProfile(updated.id, updated.linked_accounts);
      }
      const wallet = profile.stellarWallets[0];
      if (!wallet) {
        throw new Error("Privy returned no Stellar wallet");
      }
      return { ...profile, wallet };
    } catch (err) {
      throw this.unavailable("privy_ensure_wallet_failed", err);
    }
  }

  private async findUserByEmail(
    client: PrivyClient,
    address: string
  ): Promise<PrivyUserProfile | null> {
    try {
      const user = await client.users().getByEmailAddress({ address });
      return toProfile(user.id, user.linked_accounts);
    } catch (err) {
      if (err instanceof APIError && err.status === 404) return null;
      throw err;
    }
  }

  private unavailable(event: string, err: unknown) {
    this.logger.error({
      event,
      reason: err instanceof Error ? err.message : String(err),
    });
    return new ServiceUnavailableException({
      code: PrivyErrorCode.PRIVY_UNAVAILABLE,
    });
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
      String(account.wallet_client_type).startsWith("privy")
    ) {
      stellarWallets.push({
        address: account.address,
        walletId: "id" in account ? (account.id ?? null) : null,
      });
    }
  }

  return { userId, email: email?.toLowerCase() ?? null, stellarWallets };
}
