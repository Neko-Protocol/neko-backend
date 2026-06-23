import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import {
  UpdateCampaignDto,
  UpdateCampaignTvlDto,
} from "./dto/update-campaign.dto";

@ApiTags("admin/campaigns")
@Controller("admin/campaigns")
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: "List campaigns." })
  list() {
    return this.svc.list();
  }

  @Get("stats")
  @ApiOperation({ summary: "Campaign counts + total TVL moved." })
  stats() {
    return this.svc.getStats();
  }

  @Post()
  @ApiOperation({ summary: "Create a draft campaign." })
  create(@Body() body: CreateCampaignDto) {
    return this.svc.create(body);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a campaign." })
  async get(@Param("id") id: string) {
    const campaign = await this.svc.get(id);
    if (!campaign) throw new NotFoundException({ code: "NOT_FOUND" });
    return campaign;
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a draft campaign." })
  update(@Param("id") id: string, @Body() body: UpdateCampaignDto) {
    return this.svc.update(id, body);
  }

  @Get(":id/preview")
  @ApiOperation({ summary: "Recipient count + masked sample for a campaign." })
  preview(@Param("id") id: string) {
    return this.svc.preview(id);
  }

  @Post(":id/send")
  @ApiOperation({ summary: "Send a campaign to its segment." })
  send(@Param("id") id: string) {
    return this.svc.send(id);
  }

  @Patch(":id/tvl")
  @ApiOperation({ summary: "Set the TVL moved for a campaign." })
  async tvl(@Param("id") id: string, @Body() body: UpdateCampaignTvlDto) {
    await this.svc.updateTvl(id, body.tvl_moved);
    return { ok: true };
  }
}
