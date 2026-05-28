import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type {
  TransactionStatus,
  TransactionStatusError as TransactionStatusErrorContract,
  TransactionStatusResponse,
} from "@neko/api-contracts";

export type { TransactionStatus };

export class TransactionStatusError implements TransactionStatusErrorContract {
  @ApiProperty()
  code!: string;

  @ApiPropertyOptional()
  message?: string;
}

export class TransactionStatusDto implements TransactionStatusResponse {
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
