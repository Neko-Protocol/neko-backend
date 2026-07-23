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
import { ErrorCode } from "@neko/api-contracts";
import {
  CreateRecommendedDto,
  UpdateRecommendedDto,
} from "./dto/create-recommended.dto";
import { RecommendedStrategiesService } from "./recommended-strategies.service";

@ApiTags("admin/recommended")
@Controller("admin/recommended")
export class RecommendedStrategiesController {
  constructor(private readonly svc: RecommendedStrategiesService) {}

  @Get()
  @ApiOperation({ summary: "List recommended strategies." })
  list() {
    return this.svc.list();
  }

  @Get("catalog")
  @ApiOperation({ summary: "List catalog destinations." })
  async catalog() {
    return { destinations: await this.svc.listCatalogDestinations() };
  }

  @Post()
  @ApiOperation({ summary: "Create a recommended strategy." })
  create(@Body() body: CreateRecommendedDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a recommended strategy." })
  async get(@Param("id") id: string) {
    const row = await this.svc.get(id);
    if (!row) throw new NotFoundException({ code: ErrorCode.NOT_FOUND });
    return row;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a recommended strategy." })
  async update(@Param("id") id: string, @Body() body: UpdateRecommendedDto) {
    await this.svc.update(id, body);
    return { ok: true };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a recommended strategy." })
  async remove(@Param("id") id: string) {
    await this.svc.delete(id);
    return { ok: true };
  }
}
