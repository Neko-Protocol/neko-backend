describe("XdrValidator.parseAndValidate", () => {
  describe("allowed paths", () => {
    it.todo(
      "valid invokeHostFunction op on allowlisted contractId with allowed fnName returns { hash, sourceAccount, passphrase, ops }"
    );

    it.todo(
      "multi-op tx where every op passes returns ops array with one entry per operation"
    );

    it.todo(
      "Payment op with any destination + asset is allowed (asset transfers are not contract-bound)"
    );

    it.todo(
      "fnName 'deposit' on allowlisted lending pool passes"
    );

    it.todo(
      "fnName 'withdraw' on allowlisted lending pool passes"
    );

    it.todo(
      "fnName 'submit' on allowlisted lending pool passes"
    );

    it.todo(
      "fnName 'mint' / 'burn' on allowlisted asset SAC passes"
    );
  });

  describe("disallowed contract", () => {
    it.todo(
      "invokeHostFunction targeting a contractId NOT in the allowlist throws UnprocessableEntityException"
    );

    it.todo(
      "in NODE_ENV=production, error body is { code: 'PREPARE_REJECTED', traceId? } with NO contractId leaked"
    );

    it.todo(
      "in NODE_ENV=development, error body is { code: 'DISALLOWED_CONTRACT', details: { contractId } }"
    );
  });

  describe("disallowed operation type", () => {
    it.todo(
      "ManageData op throws 422 DISALLOWED_OPERATION"
    );

    it.todo(
      "PathPaymentStrictReceive op throws 422 DISALLOWED_OPERATION"
    );

    it.todo(
      "SetOptions op throws 422 DISALLOWED_OPERATION"
    );

    it.todo(
      "CreateAccount op throws 422 DISALLOWED_OPERATION"
    );
  });

  describe("disallowed function name", () => {
    it.todo(
      "invoke on allowlisted contract with fnName NOT in allowed list (e.g. 'admin_transfer') throws 422 DISALLOWED_OPERATION"
    );

    it.todo(
      "invoke on allowlisted contract with empty fnName throws 422 DISALLOWED_OPERATION"
    );
  });

  describe("malformed XDR", () => {
    it.todo(
      "garbage string input throws BadRequestException with code INVALID_XDR"
    );

    it.todo(
      "empty string input throws BadRequestException with code INVALID_XDR"
    );

    it.todo(
      "valid base64 but not a stellar tx envelope throws INVALID_XDR"
    );
  });

  describe("multi-op tx: any disallowed op fails the whole tx", () => {
    it.todo(
      "tx with [allowed invoke, disallowed ManageData] throws DISALLOWED_OPERATION"
    );

    it.todo(
      "tx with [allowed invoke, disallowed-contract invoke] throws DISALLOWED_CONTRACT (dev) / PREPARE_REJECTED (prod)"
    );

    it.todo(
      "tx with multiple allowed invokes on different allowlisted contracts passes and returns ops array preserving order"
    );
  });

  describe("hash + sourceAccount extraction", () => {
    it.todo(
      "hash equals tx.hash().toString('hex') (32 bytes → 64 hex chars)"
    );

    it.todo(
      "sourceAccount equals tx.source (G... public key)"
    );

    it.todo(
      "passphrase equals StellarRpcService.getNetworkPassphrase() return value"
    );
  });
});
