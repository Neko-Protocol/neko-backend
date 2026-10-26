import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsString, MaxLength } from "class-validator";

export class ReviewMilestoneDto {
  @ApiProperty()
  @IsBoolean()
  approved!: boolean;

  @ApiProperty({ description: "Only its SHA-256 goes on-chain." })
  @IsString()
  @MaxLength(2000)
  note!: string;
}
