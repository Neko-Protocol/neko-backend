import { IsEmail, IsOptional, IsString } from "class-validator";

/** Test-send for unsaved composer copy, so previews leave no draft behind. */
export class TestEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  subject!: string;

  @IsString()
  body_html!: string;
}

/** Test-send for a stored message. */
export class TestMessageDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  subject?: string;
}
