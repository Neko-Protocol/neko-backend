import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateActivationDto {
  @ApiProperty({ description: "Activation name (e.g. bootcamp cohort)." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: "XLM reward per participant." })
  @IsNumber()
  @IsPositive()
  reward_xlm!: number;

  @ApiProperty({
    description: "ISO timestamp after which verifications no longer count.",
  })
  @IsDateString()
  expires_at!: string;

  @ApiProperty({ description: "Participant emails eligible for the reward." })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiProperty({
    description: "Admin identifier creating the activation.",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  created_by?: string;

  @ApiProperty({
    description: "Email an invitation to each participant on creation.",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  send_invites?: boolean;
}
