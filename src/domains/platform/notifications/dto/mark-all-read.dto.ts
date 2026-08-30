import { IsString } from "class-validator";

export class MarkAllReadDto {
  @IsString()
  wallet!: string;
}
