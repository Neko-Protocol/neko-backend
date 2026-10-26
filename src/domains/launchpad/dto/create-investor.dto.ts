import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID } from "class-validator";

export class CreateInvestorDto {
  @ApiProperty({ description: "Approved verification to bind." })
  @IsUUID()
  verification_id!: string;

  @ApiProperty({ description: "Stellar wallet public key (G...) to whitelist." })
  @IsString()
  wallet_address!: string;
}
