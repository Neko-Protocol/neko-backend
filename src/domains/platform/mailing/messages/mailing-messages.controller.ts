import {
  BadRequestException,
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
import { EmailService } from "@core/email/email.service";
import { AUDIENCES } from "../audiences/mailing-audiences.types";
import { renderEmailHtml } from "../email-render";
import { TRIGGER_TYPES } from "../mailing-triggers.types";
import { MailingBroadcastSendService } from "./mailing-broadcast-send.service";
import { CreateMailingMessageDto } from "./dto/create-mailing-message.dto";
import { TestEmailDto } from "./dto/test-email.dto";
import { UpdateMailingMessageDto } from "./dto/update-mailing-message.dto";
import { MailingMessagesService } from "./mailing-messages.service";
import { isMessageKind } from "./mailing-messages.types";

@ApiTags("admin/mailing/messages")
@Controller("admin/mailing/messages")
export class MailingMessagesController {
  constructor(
    private readonly svc: MailingMessagesService,
    private readonly broadcasts: MailingBroadcastSendService,
    private readonly email: EmailService
  ) {}

  @Get()
  @ApiOperation({
    summary: "List messages, optionally filtered to one kind.",
  })
  list(@Query("kind") kind?: string) {
    if (kind !== undefined && !isMessageKind(kind)) {
      throw new BadRequestException({ code: "INVALID_KIND" });
    }
    return this.svc.list(kind);
  }

  @Get("audiences")
  @ApiOperation({ summary: "Audience catalog for the admin UI." })
  audiences() {
    return AUDIENCES;
  }

  @Get("triggers")
  @ApiOperation({ summary: "Trigger catalog for the admin UI." })
  triggers() {
    return TRIGGER_TYPES;
  }

  @Post("test")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Send unsaved composer copy to one test address." })
  async sendTest(@Body() body: TestEmailDto) {
    if (!body.subject.trim() || !body.body_html.trim()) {
      throw new BadRequestException({ code: "CONTENT_REQUIRED" });
    }
    if (!this.email.isConfigured) {
      throw new BadRequestException({ code: "EMAIL_NOT_CONFIGURED" });
    }
    await this.email.sendStrict({
      to: body.email,
      subject: body.subject.trim(),
      html: renderEmailHtml({
        bodyHtml: body.body_html,
        email: body.email,
        unsubscribeUrl: null,
      }),
    });
    return { ok: true };
  }

  @Post()
  @ApiOperation({ summary: "Create a draft broadcast or automation." })
  create(@Body() body: CreateMailingMessageDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a message." })
  async get(@Param("id") id: string) {
    const message = await this.svc.get(id);
    if (!message) throw new NotFoundException({ code: "NOT_FOUND" });
    return message;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a message that hasn't been sent." })
  update(@Param("id") id: string, @Body() body: UpdateMailingMessageDto) {
    return this.svc.update(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a draft message." })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }

  @Post(":id/send")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Send a broadcast to its full audience." })
  send(@Param("id") id: string) {
    return this.broadcasts.send(id);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activate an automation." })
  activate(@Param("id") id: string) {
    return this.svc.setStatus(id, "active");
  }

  @Post(":id/pause")
  @ApiOperation({ summary: "Pause an active automation." })
  pause(@Param("id") id: string) {
    return this.svc.setStatus(id, "paused");
  }

  @Post(":id/archive")
  @ApiOperation({ summary: "Archive an automation." })
  archive(@Param("id") id: string) {
    return this.svc.setStatus(id, "archived");
  }

  @Post(":id/unarchive")
  @ApiOperation({ summary: "Restore an archived automation to draft." })
  unarchive(@Param("id") id: string) {
    return this.svc.setStatus(id, "draft");
  }

  @Get(":id/sends")
  @ApiOperation({ summary: "Per-recipient send rows for a message." })
  sends(@Param("id") id: string) {
    return this.svc.listSends(id);
  }

  @Get(":id/stats")
  @ApiOperation({ summary: "Send counts for a message." })
  stats(@Param("id") id: string) {
    return this.svc.getSendStats(id);
  }
}
