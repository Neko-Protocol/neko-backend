describe("SorobanErrorMapper", () => {
  describe("mapped Soroban error codes → HttpException matrix", () => {
    it.todo(
      "InvalidAction → ForbiddenException 403 with body code 'INVALID_ACTION'"
    );

    it.todo(
      "InvalidArgument → BadRequestException 400 with body code 'INVALID_ARGUMENT'"
    );

    it.todo(
      "InsufficientBalance → UnprocessableEntityException 422 with body code 'INSUFFICIENT_BALANCE'"
    );

    it.todo(
      "RateExceeded → UnprocessableEntityException 422 with body code 'RATE_EXCEEDED'"
    );

    it.todo(
      "InternalContractError → UnprocessableEntityException 422 with body code 'INTERNAL_CONTRACT_ERROR'"
    );

    it.todo(
      "BudgetExceeded → UnprocessableEntityException 422 with body code 'BUDGET_EXCEEDED'"
    );

    it.todo(
      "InvalidInput → BadRequestException 400 with body code 'INVALID_INPUT'"
    );
  });

  describe("unmapped contract error", () => {
    it.todo(
      "unknown Soroban error code → UnprocessableEntityException 422 with generic 'SOROBAN_CONTRACT_ERROR'"
    );

    it.todo(
      "raw RPC payload missing a code field → falls through to SOROBAN_CONTRACT_ERROR"
    );
  });

  describe("prod vs dev body shape", () => {
    it.todo(
      "in NODE_ENV=production, mapped exception body excludes rawScvalDetails"
    );

    it.todo(
      "in NODE_ENV=production, unmapped exception body excludes rawScvalDetails and rawCode"
    );

    it.todo(
      "in NODE_ENV=development, mapped exception body includes rawScvalDetails with full diagnostic info"
    );

    it.todo(
      "in NODE_ENV=development, unmapped exception body includes rawCode for debugging"
    );
  });

  describe("traceId propagation", () => {
    it.todo(
      "every mapped HttpException body includes the traceId passed by the caller"
    );

    it.todo(
      "traceId is preserved in the unmapped SOROBAN_CONTRACT_ERROR body"
    );
  });
});
