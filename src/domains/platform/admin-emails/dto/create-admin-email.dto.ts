import { IsEmail, IsOptional } from "class-validator";

export class CreateAdminEmailDto {
  @IsEmail()
  email!: string;

  /** Acting admin's email, recorded as the inviter. */
  @IsOptional()
  @IsEmail()
  added_by?: string;
}
