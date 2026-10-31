import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsUUID } from "class-validator";

export class CreateAccountDto {
  @ApiProperty({ description: "Approved verification to claim." })
  @IsUUID()
  verification_id!: string;

  @ApiProperty({ description: "Email that will own the Privy account." })
  @IsEmail()
  email!: string;
}
