import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsString, Max, Min } from "class-validator";
import { FAUCET_MAX_AMOUNT } from "../chain/faucet.service";

export class FaucetUsdcDto {
  @ApiProperty({ description: "A G... account with a test USDC trustline." })
  @IsString()
  address!: string;

  @ApiProperty({ description: `Whole USDC, at most ${FAUCET_MAX_AMOUNT}.` })
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0.0000001)
  @Max(FAUCET_MAX_AMOUNT)
  amount!: number;
}
