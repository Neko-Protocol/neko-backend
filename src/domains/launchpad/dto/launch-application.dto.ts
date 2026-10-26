import { ApiProperty } from "@nestjs/swagger";
import { IsISO8601, Matches } from "class-validator";

export class LaunchApplicationDto {
  @ApiProperty({ description: "Token ticker: 2 to 12 capitals or digits." })
  @Matches(/^[A-Z0-9]{2,12}$/)
  token_symbol!: string;

  @ApiProperty({
    description:
      "ISO timestamp; in the future and before the first repayment is due.",
  })
  @IsISO8601()
  funding_deadline!: string;
}
