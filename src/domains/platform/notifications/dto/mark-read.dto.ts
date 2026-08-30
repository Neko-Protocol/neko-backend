import { ArrayMaxSize, IsArray, IsString, IsUUID } from "class-validator";

export class MarkReadDto {
  @IsString()
  wallet!: string;

  /** Capped so one request cannot ask for an unbounded UPDATE ... IN (...). */
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  ids!: string[];
}
