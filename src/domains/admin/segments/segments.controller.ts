import { BadRequestException, Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SegmentsService } from "./segments.service";
import { isSegmentId } from "./segments.types";

@ApiTags("admin/segments")
@Controller("admin/segments")
export class SegmentsController {
  constructor(private readonly svc: SegmentsService) {}

  @Get(":id/count")
  @ApiOperation({ summary: "Recipient count for a segment." })
  async count(@Param("id") id: string) {
    if (!isSegmentId(id)) {
      throw new BadRequestException({ code: "INVALID_SEGMENT" });
    }
    return { count: await this.svc.getSegmentCount(id) };
  }
}
