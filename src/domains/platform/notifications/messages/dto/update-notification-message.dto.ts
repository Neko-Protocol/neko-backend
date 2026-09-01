import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  MAILING_AUDIENCE_IDS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TRIGGER_IDS,
} from "@neko/api-contracts";

export class UpdateNotificationMessageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string | null;

  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES as readonly string[])
  category?: string;

  @IsOptional()
  @IsIn(MAILING_AUDIENCE_IDS as readonly string[])
  audience?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_TRIGGER_IDS as readonly string[])
  trigger_type?: string;

  @IsOptional()
  @IsObject()
  trigger_params?: Record<string, unknown>;
}
