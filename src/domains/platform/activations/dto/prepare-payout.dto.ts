import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Matches } from "class-validator";

export class PreparePayoutDto {
  @ApiProperty({ description: "activation_participants row id." })
  @IsUUID()
  participant_id!: string;

  @ApiProperty({ description: "Admin Stellar public key paying the reward." })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: "admin_wallet must be a Stellar public key" })
  admin_wallet!: string;
}
