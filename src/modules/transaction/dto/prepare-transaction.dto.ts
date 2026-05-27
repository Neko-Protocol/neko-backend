import { IsBase64, IsString, MaxLength, MinLength } from "class-validator";

export class PrepareTransactionDto {
  @IsString()
  @IsBase64()
  @MinLength(1)
  @MaxLength(65536)
  unsignedXdr!: string;
}
