import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ErrorCode,
  type AccountPublic,
  type BootstrapResponse,
  type MeResponse,
  type WalletNetwork,
  type WalletPublic,
} from "@neko-protocol/api-contracts";
import { PrivyService } from "@core/privy/privy.service";
import type { PrivyPrincipal } from "@core/privy/privy.types";
import { SupabaseService } from "@core/supabase/supabase.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import {
  PRIVY_PROVIDER,
  type AccountRow,
  type WalletActivationRow,
  type WalletRow,
} from "./accounts.types";

const isDuplicate = (error: { code?: string; message?: string } | null) =>
  Boolean(
    error &&
    (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))
  );

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly privy: PrivyService,
    private readonly config: ConfigService
  ) {}

  private get db() {
    return this.supabase.client;
  }

  currentNetwork(): WalletNetwork {
    const net =
      this.config.get<string>("STELLAR_NETWORK")?.trim().toUpperCase() ?? "";
    return net === "MAINNET" || net === "PUBLIC" || net === "PUBNET"
      ? "mainnet"
      : "testnet";
  }

  private dbError(event: string, error: unknown): never {
    this.logger.error({ event, error });
    throw new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }

  /**
   * Creates (or refreshes) the caller's account, identity and wallets from
   * what Privy reports. Safe to call on every app start: a second call
   * changes nothing but last_seen_at.
   */
  async bootstrap(principal: PrivyPrincipal): Promise<BootstrapResponse> {
    const profile = await this.privy.getUser(principal.userId);
    let created = false;

    let accountId = await this.findAccountId(principal);
    if (accountId) {
      await this.db
        .from("account_identities")
        .update({
          last_seen_at: new Date().toISOString(),
          email: profile.email,
        })
        .eq("provider", PRIVY_PROVIDER)
        .eq("provider_subject", principal.userId);
      if (profile.email) {
        await this.db
          .from("accounts")
          .update({ email: profile.email })
          .eq("id", accountId)
          .is("email", null);
      }
    } else {
      const { data: account, error: accountError } = await this.db
        .from("accounts")
        .insert({ email: profile.email })
        .select("id")
        .single();
      if (accountError || !account) {
        this.dbError("account_insert_failed", accountError);
      }
      const newId = (account as { id: string }).id;

      const { error: identityError } = await this.db
        .from("account_identities")
        .insert({
          account_id: newId,
          provider: PRIVY_PROVIDER,
          provider_subject: principal.userId,
          email: profile.email,
        });

      if (isDuplicate(identityError)) {
        // A concurrent bootstrap won the race; drop our orphan account.
        await this.db.from("accounts").delete().eq("id", newId);
        accountId = await this.findAccountId(principal);
        if (!accountId) this.dbError("identity_race_unresolved", identityError);
      } else if (identityError) {
        await this.db.from("accounts").delete().eq("id", newId);
        this.dbError("identity_insert_failed", identityError);
      } else {
        accountId = newId;
        created = true;
      }
    }

    await this.syncWallets(accountId!, profile.stellarWallets);

    if (created) {
      this.logger.log({ event: "account_created", accountId });
    }
    return { ...(await this.loadMe(accountId!)), created };
  }

  private async syncWallets(
    accountId: string,
    wallets: { address: string; walletId: string | null }[]
  ): Promise<void> {
    if (wallets.length === 0) return;
    const network = this.currentNetwork();

    const { data: existing, error } = await this.db
      .from("wallets")
      .select("*")
      .eq("account_id", accountId)
      .eq("network", network);
    if (error) this.dbError("wallets_select_failed", error);

    const rows = (existing ?? []) as WalletRow[];
    let hasPrimary = rows.some((w) => w.is_primary);

    for (const wallet of wallets) {
      const known = rows.find((w) => w.address === wallet.address);
      if (known) {
        if (wallet.walletId && known.provider_wallet_id !== wallet.walletId) {
          await this.db
            .from("wallets")
            .update({ provider_wallet_id: wallet.walletId })
            .eq("id", known.id);
        }
        continue;
      }

      const { error: insertError } = await this.db.from("wallets").insert({
        account_id: accountId,
        chain: "stellar",
        network,
        address: wallet.address,
        kind: "embedded",
        provider: PRIVY_PROVIDER,
        provider_wallet_id: wallet.walletId,
        is_primary: !hasPrimary,
      });
      if (isDuplicate(insertError)) {
        // The address belongs to another account. Privy wallets are per
        // user, so this means data drift; never reassign it silently.
        this.logger.error({
          event: "wallet_owned_by_other_account",
          accountId,
          address: wallet.address,
        });
        continue;
      }
      if (insertError) this.dbError("wallet_insert_failed", insertError);
      hasPrimary = true;
    }
  }

  async me(principal: PrivyPrincipal): Promise<MeResponse> {
    return this.loadMe(await this.requireAccountId(principal));
  }

  async updateProfile(
    principal: PrivyPrincipal,
    dto: UpdateProfileDto
  ): Promise<MeResponse> {
    const accountId = await this.requireAccountId(principal);
    const patch: Record<string, string> = {};
    if (dto.display_name !== undefined)
      patch.display_name = dto.display_name.trim();
    if (dto.country !== undefined) patch.country = dto.country;
    if (dto.locale !== undefined) patch.locale = dto.locale;
    if (dto.terms_version !== undefined) {
      patch.terms_version = dto.terms_version;
      patch.terms_accepted_at = new Date().toISOString();
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await this.db
        .from("accounts")
        .update(patch)
        .eq("id", accountId);
      if (error) this.dbError("account_update_failed", error);
    }
    return this.loadMe(accountId);
  }

  async findAccountId(principal: PrivyPrincipal): Promise<string | null> {
    const { data, error } = await this.db
      .from("account_identities")
      .select("account_id")
      .eq("provider", PRIVY_PROVIDER)
      .eq("provider_subject", principal.userId)
      .maybeSingle();
    if (error) this.dbError("identity_select_failed", error);
    return (data as { account_id: string } | null)?.account_id ?? null;
  }

  async requireAccountId(principal: PrivyPrincipal): Promise<string> {
    const id = await this.findAccountId(principal);
    if (!id) {
      throw new NotFoundException({ code: ErrorCode.ACCOUNT_NOT_FOUND });
    }
    return id;
  }

  /** The caller's primary wallet on the network this backend serves. */
  /**
   * The caller's primary wallet on this backend's network, with its
   * activation embedded: two queries (identity, wallet) per call.
   */
  async requirePrimaryWallet(principal: PrivyPrincipal): Promise<WalletPublic> {
    const accountId = await this.requireAccountId(principal);
    const network = this.currentNetwork();
    const { data, error } = await this.db
      .from("wallets")
      .select(WALLET_WITH_ACTIVATION)
      .eq("account_id", accountId)
      .eq("network", network)
      .eq("is_primary", true)
      .maybeSingle();
    if (error) this.dbError("wallet_select_failed", error);
    if (!data) {
      throw new NotFoundException({ code: ErrorCode.WALLET_NOT_FOUND });
    }
    return fromEmbedded(data as WalletWithActivations);
  }

  async loadMe(accountId: string): Promise<MeResponse> {
    const { data: account, error } = await this.db
      .from("accounts")
      .select("*")
      .eq("id", accountId)
      .single();
    if (error || !account) this.dbError("account_select_failed", error);

    const { data: wallets, error: walletsError } = await this.db
      .from("wallets")
      .select(WALLET_WITH_ACTIVATION)
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });
    if (walletsError) this.dbError("wallets_select_failed", walletsError);

    const row = account as AccountRow;
    return {
      account: toAccountPublic(row),
      wallets: ((wallets ?? []) as WalletWithActivations[]).map(fromEmbedded),
      needs_profile: !row.display_name || !row.terms_accepted_at,
    };
  }
}

/** Wallet columns plus its activation rows, embedded by PostgREST. */
const WALLET_WITH_ACTIVATION = "*, wallet_activations(*)";

type WalletWithActivations = WalletRow & {
  wallet_activations: WalletActivationRow[] | WalletActivationRow | null;
};

function fromEmbedded(row: WalletWithActivations): WalletPublic {
  const embedded = row.wallet_activations;
  const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
  return toWalletPublic(
    row,
    list.find((a) => a.network === row.network)
  );
}

function toAccountPublic(row: AccountRow): AccountPublic {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    country: row.country,
    locale: row.locale,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    created_at: row.created_at,
  };
}

export function toWalletPublic(
  row: WalletRow,
  activation?: WalletActivationRow
): WalletPublic {
  return {
    id: row.id,
    chain: row.chain,
    network: row.network,
    address: row.address,
    kind: row.kind,
    is_primary: row.is_primary,
    activation_status: activation?.status ?? "not_activated",
    activation_tx_hash: activation?.tx_hash ?? null,
    created_at: row.created_at,
  };
}
