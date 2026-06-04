import { IsNotEmpty, IsString } from "class-validator";

export class PoolIdParamDto {
  @IsString()
  @IsNotEmpty()
  poolId!: string;
}
