import { IsNotEmpty, IsString } from "class-validator";

export class VaultIdParamDto {
  @IsString()
  @IsNotEmpty()
  vaultId!: string;
}
