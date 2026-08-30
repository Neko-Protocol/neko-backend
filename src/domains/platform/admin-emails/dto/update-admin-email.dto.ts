import { IsBoolean } from "class-validator";

export class UpdateAdminEmailDto {
  @IsBoolean()
  is_active!: boolean;
}
