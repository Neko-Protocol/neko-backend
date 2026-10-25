import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUrl, MaxLength, MinLength } from "class-validator";

export class ApplicationDocumentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsUrl()
  @MaxLength(2000)
  url!: string;
}
