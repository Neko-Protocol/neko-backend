import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateAdminEmailDto } from "./dto/create-admin-email.dto";
import { UpdateAdminEmailDto } from "./dto/update-admin-email.dto";
import { AdminEmailsService } from "./admin-emails.service";

@ApiTags("admin/admins")
@Controller("admin/admins")
export class AdminEmailsController {
  constructor(private readonly svc: AdminEmailsService) {}

  @Get()
  @ApiOperation({ summary: "List admin emails." })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: "Authorize a new admin email." })
  add(@Body() body: CreateAdminEmailDto) {
    return this.svc.add(body.email, body.added_by);
  }

  @Patch(":email")
  @ApiOperation({ summary: "Activate or deactivate an admin email." })
  setActive(@Param("email") email: string, @Body() body: UpdateAdminEmailDto) {
    return this.svc.setActive(email, body.is_active);
  }
}
