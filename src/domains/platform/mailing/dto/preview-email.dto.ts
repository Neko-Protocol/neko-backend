import { IsEmail, IsOptional, IsString } from "class-validator";

export class PreviewEmailDto {
  @IsString()
  body_html!: string;

  /** Sample address used for {{email}} substitution and the footer. */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Sample wallet used for {{wallet_address}} substitution. */
  @IsOptional()
  @IsString()
  wallet_address?: string;
}
