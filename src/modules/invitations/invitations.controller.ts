import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AcceptInvitationDto } from "./dto/accept-invitation.dto";
import { CreateInvitationDto } from "./dto/create-invitation.dto";
import { InvitationsService } from "./invitations.service";
import { isInvitationType } from "./invitations.types";

@ApiTags("admin/invitations")
@Controller("admin/invitations")
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Get()
  @ApiOperation({ summary: "List invitations (filterable)." })
  async list(
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("assigned_to") assignedTo?: string,
    @Query("strategy_id") strategyId?: string
  ) {
    await this.svc.markExpired();
    return this.svc.list({
      status:
        status === "pending" || status === "accepted" || status === "expired"
          ? status
          : undefined,
      type: type && isInvitationType(type) ? type : undefined,
      assigned_to: assignedTo || undefined,
      strategy_id: strategyId || undefined,
    });
  }

  @Post()
  @ApiOperation({ summary: "Create an invitation and email it." })
  async create(@Body() body: CreateInvitationDto) {
    await this.svc.markExpired();
    return this.svc.create(body);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Mark an invitation accepted." })
  accept(@Param("id") id: string, @Body() body: AcceptInvitationDto) {
    return this.svc.accept(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an invitation." })
  async remove(@Param("id") id: string) {
    await this.svc.delete(id);
    return { ok: true };
  }
}
