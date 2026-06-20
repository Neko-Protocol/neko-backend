import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminDashboardService } from "./admin-dashboard.service";

function toInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@ApiTags("admin/dashboard")
@Controller("admin/dashboard")
export class AdminDashboardController {
  constructor(private readonly svc: AdminDashboardService) {}

  @Get("overview")
  @ApiOperation({ summary: "Headline metric cards." })
  overview() {
    return this.svc.getOverviewStats();
  }

  @Get("daily-new-users")
  @ApiOperation({ summary: "New users per day." })
  dailyNewUsers(@Query("days") days?: string) {
    return this.svc.getDailyNewUsers(toInt(days, 30));
  }

  @Get("wallet-providers")
  @ApiOperation({ summary: "Wallet provider breakdown." })
  walletProviders() {
    return this.svc.getWalletProviderBreakdown();
  }

  @Get("networks")
  @ApiOperation({ summary: "Network breakdown." })
  networks() {
    return this.svc.getNetworkBreakdown();
  }

  @Get("currencies")
  @ApiOperation({ summary: "Preferred currency distribution." })
  currencies() {
    return this.svc.getCurrencyDistribution();
  }

  @Get("transactions-by-type")
  @ApiOperation({ summary: "Transaction counts by action type." })
  transactionsByType() {
    return this.svc.getTransactionsByType();
  }

  @Get("daily-transactions")
  @ApiOperation({ summary: "Transactions per day." })
  dailyTransactions(@Query("days") days?: string) {
    return this.svc.getDailyTransactions(toInt(days, 30));
  }

  @Get("top-assets")
  @ApiOperation({ summary: "Top assets by volume." })
  topAssets(@Query("limit") limit?: string) {
    return this.svc.getTopAssetsByVolume(toInt(limit, 10));
  }

  @Get("recent-activity")
  @ApiOperation({ summary: "Most recent audit-log activity." })
  recentActivity(@Query("limit") limit?: string) {
    return this.svc.getRecentActivity(toInt(limit, 50));
  }

  @Get("email-verification-stats")
  @ApiOperation({ summary: "Verified vs total user counts." })
  emailVerificationStats() {
    return this.svc.getEmailVerificationStats();
  }
}
