import { IsString, MinLength } from "class-validator";

export class VerifyPasswordDto {
  @IsString()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
