import { IsNotEmpty, IsString } from "class-validator";

export class SymbolParamDto {
  @IsString()
  @IsNotEmpty()
  symbol!: string;
}
