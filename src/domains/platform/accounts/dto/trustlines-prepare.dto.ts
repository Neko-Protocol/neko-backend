import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from "class-validator";

const ASSET_REF = /^([A-Za-z0-9]{1,12}:G[A-Z2-7]{55}|C[A-Z2-7]{55})$/;

export class TrustlinesPrepareDto {
  @ApiProperty({
    description:
      "Classic assets to open trustlines for, as CODE:ISSUER or SAC contract id.",
    example: ["CETES:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC"],
    maxItems: 5,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(ASSET_REF, { each: true })
  assets!: string[];
}
