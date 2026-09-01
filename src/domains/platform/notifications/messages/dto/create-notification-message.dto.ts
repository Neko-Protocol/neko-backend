import {
  IsEmail,
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

export class CreateNotificationMessageDto {
  @IsIn(["trigger", "announcement"])
  kind!: "trigger" | "announcement";

  @IsString()
  name!: string;

  /** Kept short: this is one line in a sidebar popover, not an email subject. */
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(500)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string | null;

  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES as readonly string[])
  category?: string;

  /**
   * Announcements only. A trigger already identifies its recipient by their own
   * action, so narrowing it by audience is at best a no-op.
   */
  @IsOptional()
  @IsIn(MAILING_AUDIENCE_IDS as readonly string[])
  audience?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_TRIGGER_IDS as readonly string[])
  trigger_type?: string | null;

  @IsOptional()
  @IsObject()
  trigger_params?: Record<string, unknown>;

  /** Acting admin's email; stored only if it matches an active admin_emails row. */
  @IsOptional()
  @IsEmail()
  created_by?: string;
}
