import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { TRIGGER_TYPES } from "../mailing-triggers.types";
import { CreateMailingAutomationDto } from "./dto/create-mailing-automation.dto";
import { UpdateMailingAutomationDto } from "./dto/update-mailing-automation.dto";
import { MailingEnrollmentService } from "../enrollment/mailing-enrollment.service";
import { MailingAutomationsService } from "./mailing-automations.service";

@ApiTags("admin/mailing/automations")
@Controller("admin/mailing/automations")
export class MailingAutomationsController {
  constructor(
    private readonly svc: MailingAutomationsService,
    private readonly enrollment: MailingEnrollmentService
  ) {}

  @Get()
  @ApiOperation({ summary: "List mailing automations." })
  list() {
    return this.svc.list();
  }

  @Get("triggers")
  @ApiOperation({ summary: "Trigger type catalog for the admin UI." })
  triggers() {
    return TRIGGER_TYPES;
  }

  @Post()
  @ApiOperation({ summary: "Create a draft mailing automation." })
  create(@Body() body: CreateMailingAutomationDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a mailing automation." })
  async get(@Param("id") id: string) {
    const automation = await this.svc.get(id);
    if (!automation) throw new NotFoundException({ code: "NOT_FOUND" });
    return automation;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a draft or paused mailing automation." })
  update(@Param("id") id: string, @Body() body: UpdateMailingAutomationDto) {
    return this.svc.update(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a draft mailing automation." })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activate a mailing automation." })
  activate(@Param("id") id: string) {
    return this.svc.setStatus(id, "active");
  }

  @Post(":id/pause")
  @ApiOperation({ summary: "Pause an active mailing automation." })
  pause(@Param("id") id: string) {
    return this.svc.setStatus(id, "paused");
  }

  @Post(":id/archive")
  @ApiOperation({ summary: "Archive a mailing automation." })
  archive(@Param("id") id: string) {
    return this.svc.setStatus(id, "archived");
  }

  @Get(":id/runs")
  @ApiOperation({ summary: "List recent runs for a mailing automation." })
  runs(@Param("id") id: string) {
    return this.svc.listRuns(id);
  }

  @Get(":id/stats")
  @ApiOperation({ summary: "Run counts for a mailing automation." })
  stats(@Param("id") id: string) {
    return this.svc.getRunStats(id);
  }

  @Get(":id/preview")
  @ApiOperation({ summary: "Preview audience size for a mailing automation." })
  async preview(@Param("id") id: string) {
    const count = await this.enrollment.previewCount(id);
    return { count };
  }
}
