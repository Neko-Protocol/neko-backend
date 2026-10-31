import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class AssistantChatTurnDto {
  @ApiProperty({ enum: ["user", "assistant"] })
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  text!: string;
}

export class AssistantChatDto {
  @ApiProperty({ description: "Assistant session, one per application form." })
  @IsUUID()
  session_id!: string;

  @ApiProperty({ type: [AssistantChatTurnDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AssistantChatTurnDto)
  messages!: AssistantChatTurnDto[];

  @ApiProperty({ description: "Current form values." })
  @IsObject()
  form!: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Field the issuer is on." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  active_field?: string;
}
