import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class SubmitBatchPayoutDto {
  @ApiProperty({ description: "Activation id." })
  @IsUUID()
  activation_id!: string;

  @ApiProperty({
    description: "Participant ids included in this signed batch chunk.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  participant_ids!: string[];

  @ApiProperty({ description: "Signed transaction envelope XDR (base64)." })
  @IsString()
  @MinLength(1)
  signed_xdr!: string;
}
