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
import { NotificationAnnouncementService } from "./announcements/notification-announcement.service";
import { CreateNotificationMessageDto } from "./messages/dto/create-notification-message.dto";
import { UpdateNotificationMessageDto } from "./messages/dto/update-notification-message.dto";
import { NotificationMessagesService } from "./messages/notification-messages.service";
import { NotificationsEnrollmentService } from "./notifications-enrollment.service";
import { NOTIFICATION_TRIGGERS } from "./notifications.types";
import { NotificationStatsService } from "./stats/notification-stats.service";

@ApiTags("admin/notifications")
@Controller("admin/notifications")
export class NotificationsAdminController {
  constructor(
    private readonly messages: NotificationMessagesService,
    private readonly announcements: NotificationAnnouncementService,
    private readonly stats: NotificationStatsService,
    private readonly enrollment: NotificationsEnrollmentService
  ) {}

  @Get("triggers")
  @ApiOperation({ summary: "Trigger catalog with per-channel coverage." })
  triggers() {
    return this.stats.coverage();
  }

  @Get("trigger-catalog")
  @ApiOperation({ summary: "Trigger ids, labels, and descriptions." })
  triggerCatalog() {
    return NOTIFICATION_TRIGGERS;
  }

  @Get("stats")
  @ApiOperation({ summary: "Delivery and read counts." })
  getStats() {
    return this.stats.stats();
  }

  @Get("audience-preview")
  @ApiOperation({ summary: "Wallet count for an announcement audience." })
  audiencePreview(@Query("audience") audience = "all") {
    return this.announcements.preview(audience);
  }

  @Get("messages")
  @ApiOperation({ summary: "List notification messages." })
  list(@Query("kind") kind?: string) {
    return this.messages.list(kind);
  }

  @Post("messages")
  @ApiOperation({ summary: "Create a notification message." })
  create(@Body() body: CreateNotificationMessageDto) {
    return this.messages.create(body);
  }

  @Get("messages/:id")
  @ApiOperation({ summary: "Get a notification message." })
  async get(@Param("id") id: string) {
    const message = await this.messages.get(id);
    if (!message) throw new NotFoundException({ code: "NOT_FOUND" });
    return message;
  }

  @Patch("messages/:id")
  @ApiOperation({ summary: "Update a notification message." })
  update(@Param("id") id: string, @Body() body: UpdateNotificationMessageDto) {
    return this.messages.update(id, body);
  }

  @Delete("messages/:id")
  @ApiOperation({ summary: "Delete a notification message." })
  async remove(@Param("id") id: string) {
    await this.messages.remove(id);
    return { ok: true };
  }

  @Post("messages/:id/activate")
  @ApiOperation({ summary: "Activate a trigger message." })
  activate(@Param("id") id: string) {
    return this.messages.setStatus(id, "active");
  }

  @Post("messages/:id/pause")
  @ApiOperation({ summary: "Pause a trigger message." })
  pause(@Param("id") id: string) {
    return this.messages.setStatus(id, "paused");
  }

  @Post("messages/:id/archive")
  @ApiOperation({ summary: "Archive a trigger message." })
  archive(@Param("id") id: string) {
    return this.messages.setStatus(id, "archived");
  }

  @Post("messages/:id/unarchive")
  @ApiOperation({ summary: "Return an archived trigger message to draft." })
  unarchive(@Param("id") id: string) {
    return this.messages.setStatus(id, "draft");
  }

  @Post("messages/:id/send")
  @ApiOperation({ summary: "Fan an announcement out to its audience." })
  send(@Param("id") id: string) {
    return this.announcements.send(id);
  }

  @Post("run-enrollment")
  @ApiOperation({
    summary:
      "Run the time-based notification triggers now (inactivity, low balance).",
  })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  runEnrollment() {
    return this.enrollment.run();
  }
}
