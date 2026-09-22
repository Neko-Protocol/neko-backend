import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Body,
  Query,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { MarkAllReadDto } from "./dto/mark-all-read.dto";
import { MarkReadDto } from "./dto/mark-read.dto";
import { NotificationsService } from "./notifications.service";

/**
 * User-facing notification feed, keyed on wallet address.
 *
 * Mark-read is modelled as POST rather than PATCH because the web app reaches
 * this through `apps/web-app/src/app/api/backend-proxy/[...path]/route.ts`,
 * which only forwards GET and POST.
 */
@ApiTags("notifications")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  private requireWallet(wallet?: string): string {
    const trimmed = (wallet ?? "").trim();
    if (!trimmed) {
      throw new BadRequestException({ code: ErrorCode.WALLET_REQUIRED });
    }
    return trimmed;
  }

  @Get()
  @ApiOperation({ summary: "List a wallet's notifications, newest first." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(@Query("wallet") wallet?: string, @Query("limit") limit?: string) {
    const parsed = Number(limit);
    return this.svc.list(
      this.requireWallet(wallet),
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    );
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Unread notification count for a wallet." })
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async unreadCount(@Query("wallet") wallet?: string) {
    const count = await this.svc.unreadCount(this.requireWallet(wallet));
    return { count };
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark specific notifications read." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  markRead(@Body() dto: MarkReadDto) {
    return this.svc.markRead(this.requireWallet(dto.wallet), dto.ids);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark every notification for a wallet read." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  markAllRead(@Body() dto: MarkAllReadDto) {
    return this.svc.markAllRead(this.requireWallet(dto.wallet));
  }

  @Post("clear")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear specific notifications out of the tray." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  clear(@Body() dto: MarkReadDto) {
    return this.svc.clear(this.requireWallet(dto.wallet), dto.ids);
  }

  @Post("clear-all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear every notification for a wallet." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  clearAll(@Body() dto: MarkAllReadDto) {
    return this.svc.clearAll(this.requireWallet(dto.wallet));
  }
}
