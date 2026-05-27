export type TransactionStatus = "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND";

export interface TransactionStatusError {
  code: string;
  message?: string;
}

export interface TransactionStatusDto {
  status: TransactionStatus;
  hash: string;
  returnValue?: string;
  error?: TransactionStatusError;
  traceId?: string;
}
