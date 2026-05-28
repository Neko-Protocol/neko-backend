import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type TransactionStatus = "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND";

export class TransactionStatusError {
  @ApiProperty()
  code!: string;

  @ApiPropertyOptional()
  message?: string;
}

export class TransactionStatusDto {
  @ApiProperty({ enum: ["SUCCESS", "FAILED", "PENDING", "NOT_FOUND"] })
  status!: TransactionStatus;

  @ApiProperty()
  hash!: string;

  @ApiPropertyOptional({
    description: "Base64-encoded ScVal returned by the contract on SUCCESS.",
  })
  returnValue?: string;

  @ApiPropertyOptional({ type: TransactionStatusError })
  error?: TransactionStatusError;

  @ApiPropertyOptional({
    description: "Request trace id, mirrors X-Request-Id.",
  })
  traceId?: string;
}
