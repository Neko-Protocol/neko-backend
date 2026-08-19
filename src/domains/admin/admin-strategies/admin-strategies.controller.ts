import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ErrorCode } from "@neko/api-contracts";
import { CreateInvitationDto } from "../invitations/dto/create-invitation.dto";
import { InvitationsService } from "../invitations/invitations.service";
import { isInvitationType } from "../invitations/invitations.types";
import { AdminStrategiesService } from "./admin-strategies.service";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpdateStrategyDto } from "./dto/update-strategy.dto";

@ApiTags("admin/strategies")
@Controller("admin/strategies")
export class AdminStrategiesController {
  constructor(
    private readonly svc: AdminStrategiesService,
    private readonly invitations: InvitationsService
  ) {}

  @Get()
  @ApiOperation({ summary: "List growth strategies with stats." })
  list() {
    return this.svc.list();
  }

  @Get("stats")
  @ApiOperation({ summary: "Strategy status counts." })
  stats() {
    return this.svc.getStats();
  }

  @Post()
  @ApiOperation({ summary: "Create a growth strategy." })
  create(@Body() body: CreateStrategyDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a strategy." })
  async get(@Param("id") id: string) {
    const strategy = await this.svc.get(id);
    if (!strategy) throw new NotFoundException({ code: ErrorCode.NOT_FOUND });
    return strategy;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a strategy." })
  async update(@Param("id") id: string, @Body() body: UpdateStrategyDto) {
    await this.svc.update(id, body);
    return { ok: true };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a strategy." })
  async remove(@Param("id") id: string) {
    await this.svc.delete(id);
    return { ok: true };
  }

  @Get(":id/real-volume")
  @ApiOperation({ summary: "Real USD volume from the invited cohort." })
  async realVolume(@Param("id") id: string) {
    const real = await this.svc.getRealVolumeUsd(id);
    if (real === null)
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND });
    return { real_volume: real };
  }

  @Get(":id/invitations")
  @ApiOperation({ summary: "List invitations for a strategy." })
  async listInvitations(
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("type") type?: string
  ) {
    await this.invitations.markExpired();
    return this.invitations.list({
      strategy_id: id,
      status:
        status === "pending" || status === "accepted" || status === "expired"
          ? status
          : undefined,
      type: type && isInvitationType(type) ? type : undefined,
    });
  }

  @Post(":id/invitations")
  @ApiOperation({ summary: "Create an invitation tied to a strategy." })
  async createInvitation(
    @Param("id") id: string,
    @Body() body: CreateInvitationDto
  ) {
    await this.invitations.markExpired();
    return this.invitations.create(body, { strategy_id: id });
  }
}
