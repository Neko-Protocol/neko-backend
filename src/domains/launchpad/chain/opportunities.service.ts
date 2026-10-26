import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { SupabaseService } from "@core/supabase/supabase.service";
import {
  LaunchpadErrorCode,
  toApplicationView,
  type ApplicationMilestone,
  type ApplicationRow,
  type AssetType,
  type OfferingType,
} from "../launchpad.types";
import { LaunchpadChainService, type PublicPlatform } from "./chain.service";

/** A live vault as Neko Pro lists it. Holds nothing private about the issuer. */
export interface OpportunityView {
  id: string;
  asset_name: string;
  asset_type: AssetType;
  description: string;
  issuer_country: string;
  target_amount: number;
  min_target: number | null;
  min_ticket: number;
  expected_yield_pct: number | null;
  term_months: number | null;
  token_symbol: string;
  vault: string;
  token: string;
  vault_id: string;
  funding_deadline: string;
  milestones: ApplicationMilestone[];
  offering_type: OfferingType;
  investor_countries: string[];
}

@Injectable()
export class OpportunitiesService {
  private readonly logger = new Logger(OpportunitiesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly chain: LaunchpadChainService
  ) {}

  async list(): Promise<{
    items: OpportunityView[];
    platform: PublicPlatform;
  }> {
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select("*, launchpad_deployments!inner(*)")
      .eq("status", "approved")
      .eq("launchpad_deployments.status", "live")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw this.dbError(error);
    const items = ((data ?? []) as ApplicationRow[])
      .map(toOpportunity)
      .filter((o): o is OpportunityView => o !== null);
    return { items, platform: await this.chain.publicPlatform() };
  }

  async get(
    id: string
  ): Promise<{ item: OpportunityView; platform: PublicPlatform }> {
    const { data, error } = await this.supabase.client
      .from("launchpad_applications")
      .select("*, launchpad_deployments(*)")
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle();
    if (error) throw this.dbError(error);
    const item = data ? toOpportunity(data as ApplicationRow) : null;
    if (!item) {
      throw new NotFoundException({
        code: LaunchpadErrorCode.OPPORTUNITY_NOT_FOUND,
      });
    }
    return { item, platform: await this.chain.publicPlatform() };
  }

  private dbError(error: unknown) {
    this.logger.error({ event: "launchpad_opportunities_db_error", error });
    return new InternalServerErrorException({ code: ErrorCode.DB_ERROR });
  }
}

function toOpportunity(row: ApplicationRow): OpportunityView | null {
  const view = toApplicationView(row);
  const d = view.deployment;
  if (!d || d.status !== "live" || !d.vault || !d.token) return null;
  return {
    id: view.id,
    asset_name: view.asset_name,
    asset_type: view.asset_type,
    description: view.description,
    issuer_country: view.issuer_country,
    target_amount: view.target_amount,
    min_target: view.min_target,
    min_ticket: view.min_ticket,
    expected_yield_pct: view.expected_yield_pct,
    term_months: view.term_months,
    token_symbol: d.token_symbol,
    vault: d.vault,
    token: d.token,
    vault_id: d.vault_id,
    funding_deadline: d.funding_deadline,
    milestones: view.milestones,
    offering_type: view.offering_type,
    investor_countries: view.investor_countries,
  };
}
