import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MinLength } from "class-validator";

export class SubmitPayoutDto {
  @ApiProperty({ description: "activation_participants row id." })
  @IsUUID()
  participant_id!: string;

  @ApiProperty({ description: "Signed transaction envelope XDR (base64)." })
  @IsString()
  @MinLength(1)
  signed_xdr!: string;
}
