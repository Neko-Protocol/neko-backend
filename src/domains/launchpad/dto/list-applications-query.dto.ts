import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import type { ApplicationStatus } from "../launchpad.types";

const STATUSES = [
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
] as const;

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ApplicationStatus;
}
