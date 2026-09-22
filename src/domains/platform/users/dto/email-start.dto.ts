import { ApiProperty } from "@nestjs/swagger";
import type { EmailStartRequest } from "@neko-protocol/api-contracts";
import { IsEmail, IsString, MinLength } from "class-validator";

export class EmailStartDto implements EmailStartRequest {
  @ApiProperty({ description: "Stellar wallet public key (G...)." })
  @IsString()
  @MinLength(1)
  wallet_address!: string;

  @ApiProperty({ description: "Email address to verify." })
  @IsEmail()
  email!: string;
}
