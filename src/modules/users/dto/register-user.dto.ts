import { ApiProperty } from "@nestjs/swagger";
import type { UserConnectEvent } from "@neko/api-contracts";
import { IsOptional, IsString, MinLength } from "class-validator";

export class RegisterUserDto implements UserConnectEvent {
  @ApiProperty({ description: "Stellar wallet public key (G...)." })
  @IsString()
  @MinLength(1)
  wallet_address!: string;

  @ApiProperty({
    description: "Connected wallet provider name, if known.",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  wallet_provider!: string | null;
}
