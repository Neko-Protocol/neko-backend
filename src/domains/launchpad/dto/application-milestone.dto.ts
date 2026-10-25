import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ApplicationMilestoneDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: "Share of proceeds for this milestone, 0-100." })
  @IsNumber()
  @Min(0)
  @Max(100)
  amount_pct!: number;

  @ApiPropertyOptional({ description: "ISO date when the milestone is due." })
  @IsOptional()
  @IsDateString()
  due?: string;
}
