import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Matches } from "class-validator";

export class PrepareBatchPayoutDto {
  @ApiProperty({ description: "Activation id." })
  @IsUUID()
  activation_id!: string;

  @ApiProperty({ description: "Admin Stellar public key paying the rewards." })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: "admin_wallet must be a Stellar public key",
  })
  admin_wallet!: string;
}
