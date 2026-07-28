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
import { CreateMailingTemplateDto } from "./dto/create-mailing-template.dto";
import { UpdateMailingTemplateDto } from "./dto/update-mailing-template.dto";
import { MailingTemplatesService } from "./mailing-templates.service";

@ApiTags("admin/mailing/templates")
@Controller("admin/mailing/templates")
export class MailingTemplatesController {
  constructor(private readonly svc: MailingTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List mailing templates." })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a mailing template." })
  create(@Body() body: CreateMailingTemplateDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a mailing template." })
  async get(@Param("id") id: string) {
    const template = await this.svc.get(id);
    if (!template) throw new NotFoundException({ code: "NOT_FOUND" });
    return template;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a mailing template." })
  update(@Param("id") id: string, @Body() body: UpdateMailingTemplateDto) {
    return this.svc.update(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a mailing template." })
  async remove(@Param("id") id: string) {
    await this.svc.remove(id);
    return { ok: true };
  }
}
