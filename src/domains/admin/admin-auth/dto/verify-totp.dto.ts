import { IsString } from "class-validator";

export class VerifyTotpDto {
  @IsString()
  email!: string;

  @IsString()
  code!: string;
}
