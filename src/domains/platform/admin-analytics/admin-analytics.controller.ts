import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminStatsService } from "./admin-stats.service";
import { AdminVaultReportingService } from "./admin-vault-reporting.service";
import { ListTransactionsQueryDto } from "./dto/list-transactions-query.dto";
import { RpcOverviewService } from "./rpc-overview.service";

@ApiTags("admin-analytics")
@Controller("admin-analytics")
export class AdminAnalyticsController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly vaultReporting: AdminVaultReportingService,
    private readonly rpcOverview: RpcOverviewService
  ) {}

  @Get("overview")
  @ApiOperation({ summary: "TVL, total volume, and swap count." })
  getOverview() {
    return this.stats.getOverview();
  }

  @Get("users")
  @ApiOperation({
    summary: "User counts: total, email-confirmed, invested, and re-invested.",
  })
  getUserStats() {
    return this.stats.getUserStats();
  }

  @Get("vault-depositors")
  @ApiOperation({
    summary:
      "Per-vault list of depositor wallets, balances, and email (when known).",
  })
  async getVaultDepositors() {
    const groups = await this.vaultReporting.getVaultDepositors();
    return { groups };
  }

  @Get("wallet-positions")
  @ApiOperation({
    summary: "Vault balances (per asset, in USD) held by a given wallet.",
  })
  async getWalletPositions(@Query("wallet") wallet?: string) {
    if (!wallet) return { positions: [] };
    const positions = await this.vaultReporting.getWalletVaultPositions(
      wallet.trim()
    );
    return { positions };
  }

  @Get("transactions")
  @ApiOperation({
    summary:
      "Paginated audit_logs transactions, with wallet email attached when known.",
  })
  listTransactions(@Query() query: ListTransactionsQueryDto) {
    const limit = Number(query.limit ?? "25");
    const offset = Number(query.offset ?? "0");
    return this.stats.listTransactions({
      actionType: query.actionType,
      wallet: query.wallet,
      from: query.from,
      to: query.to,
      limit: Number.isFinite(limit) ? limit : 25,
      offset: Number.isFinite(offset) ? offset : 0,
    });
  }

  @Get("rpc")
  @ApiOperation({
    summary:
      "Live RPC pool state and the counters behind the Grafana dashboard.",
  })
  getRpcOverview() {
    return this.rpcOverview.getSnapshot();
  }
}
