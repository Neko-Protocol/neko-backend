import { ApiProperty } from "@nestjs/swagger";
import type { UserPreferences } from "@neko/api-contracts";
import { IsObject, IsString, MinLength } from "class-validator";

export class UpdatePreferencesDto {
  @ApiProperty({ description: "Stellar wallet public key (G...)." })
  @IsString()
  @MinLength(1)
  wallet_address!: string;

  @ApiProperty({
    description: "Partial preferences to merge into the stored object.",
  })
  @IsObject()
  preferences!: UserPreferences;
}
