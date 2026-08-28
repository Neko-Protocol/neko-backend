import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, Length } from "class-validator";

export class VerifyCodeDto {
  @ApiProperty({ description: "Admin email address." })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: "6-digit sign-in code." })
  @IsString()
  @Length(6, 6)
  code!: string;
}
