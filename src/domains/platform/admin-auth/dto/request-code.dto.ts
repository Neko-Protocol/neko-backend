import { ApiProperty } from "@nestjs/swagger";
import { IsEmail } from "class-validator";

export class RequestCodeDto {
  @ApiProperty({ description: "Admin email address." })
  @IsEmail()
  email!: string;
}
