import { ApiProperty } from "@nestjs/swagger";
import type { EmailConfirmRequest } from "@neko-protocol/api-contracts";
import { IsString, MinLength } from "class-validator";

export class EmailConfirmDto implements EmailConfirmRequest {
  @ApiProperty({ description: "Stellar wallet public key (G...)." })
  @IsString()
  @MinLength(1)
  wallet!: string;

  @ApiProperty({
    description: "Supabase access token from the email confirmation redirect.",
  })
  @IsString()
  @MinLength(1)
  access_token!: string;
}
