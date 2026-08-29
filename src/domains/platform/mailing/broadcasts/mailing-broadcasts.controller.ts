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
import { Throttle } from "@nestjs/throttler";
import { AUDIENCES } from "../audiences/mailing-audiences.types";
import { CreateMailingBroadcastDto } from "./dto/create-mailing-broadcast.dto";
import { SendTestEmailDto } from "./dto/send-test-email.dto";
import { UpdateMailingBroadcastDto } from "./dto/update-mailing-broadcast.dto";
import { MailingBroadcastsService } from "./mailing-broadcasts.service";

@ApiTags("admin/mailing/broadcasts")
@Controller("admin/mailing/broadcasts")
export class MailingBroadcastsController {
  constructor(private readonly svc: MailingBroadcastsService) {}

  @Get()
  @ApiOperation({ summary: "List mass-email broadcasts." })
  list() {
    return this.svc.list();
  }

  @Get("audiences")
  @ApiOperation({ summary: "Audience catalog for the admin UI." })
  audiences() {
    return AUDIENCES;
  }

  @Get("audiences/preview")
  @ApiOperation({
    summary: "Live recipient count for an audience (opt-outs excluded).",
  })
  preview(@Query("audience") audience?: string) {
    return this.svc.previewAudience(audience);
  }

  @Post()
  @ApiOperation({ summary: "Create a draft broadcast." })
  create(@Body() body: CreateMailingBroadcastDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a broadcast." })
  async get(@Param("id") id: string) {
    const broadcast = await this.svc.get(id);
    if (!broadcast) throw new NotFoundException({ code: "NOT_FOUND" });
    return broadcast;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a draft broadcast." })
  update(@Param("id") id: string, @Body() body: UpdateMailingBroadcastDto) {
    return this.svc.update(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a draft broadcast." })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }

  @Post(":id/test")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Send the broadcast to a single test address." })
  sendTest(@Param("id") id: string, @Body() body: SendTestEmailDto) {
    return this.svc.sendTest(id, body.email);
  }

  @Post(":id/send")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send the broadcast to its full audience." })
  send(@Param("id") id: string) {
    return this.svc.send(id);
  }
}
