import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

export class SubmitTransactionDto {
  @IsString()
  @IsBase64()
  @MinLength(1)
  @MaxLength(65536)
  signedXdr!: string;
}
