import { IsOptional, IsString } from "class-validator";

export class ListAuditQueryDto {
  @IsOptional()
  @IsString()
  wallet?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
