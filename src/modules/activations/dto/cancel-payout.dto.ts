import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CancelPayoutDto {
  @ApiProperty({ description: "activation_participants row id." })
  @IsUUID()
  participant_id!: string;
}
