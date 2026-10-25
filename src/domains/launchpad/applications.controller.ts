import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthGuard } from "../platform/admin-auth/admin-auth.guard";
import { ApplicationsService } from "./applications.service";
import { CreateApplicationDto } from "./dto/create-application.dto";
import { DecideApplicationDto } from "./dto/decide-application.dto";
import { ListApplicationsQueryDto } from "./dto/list-applications-query.dto";
import {
  LaunchpadErrorCode,
  type AdminApplicationView,
  type ApplicationView,
} from "./launchpad.types";

@ApiTags("launchpad")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("launchpad/applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  private bearerToken(authorization?: string): string {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new UnauthorizedException({
        code: LaunchpadErrorCode.MISSING_ACCESS_TOKEN,
      });
    }
    return token;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Submit a tokenization application (issuer)." })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Body() dto: CreateApplicationDto,
    @Headers("authorization") authorization?: string
  ): Promise<ApplicationView> {
    return this.applications.create(this.bearerToken(authorization), dto);
  }

  @Get("mine")
  @ApiOperation({ summary: "List applications for the logged-in issuer." })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listMine(
    @Headers("authorization") authorization?: string
  ): Promise<ApplicationView[]> {
    return this.applications.listMine(this.bearerToken(authorization));
  }
}

@ApiTags("launchpad-admin")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@ApiUnauthorizedResponse({ description: "Missing or invalid admin session." })
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("launchpad/admin/applications")
export class AdminApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @ApiOperation({ summary: "List tokenization applications (admin)." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list(
    @Query() query: ListApplicationsQueryDto
  ): Promise<ApplicationView[]> {
    return this.applications.adminList(query.status);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a tokenization application (admin)." })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(
    @Param("id", ParseUUIDPipe) id: string
  ): Promise<AdminApplicationView> {
    return this.applications.adminGet(id);
  }

  @Post(":id/decision")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record a review decision (admin)." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  decide(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecideApplicationDto
  ): Promise<AdminApplicationView> {
    // AdminAuthGuard does not attach the admin email to the request.
    return this.applications.adminDecide(id, dto, null);
  }
}
