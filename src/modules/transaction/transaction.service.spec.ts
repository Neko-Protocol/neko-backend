describe("TransactionService", () => {
  describe("prepare()", () => {
    it.todo(
      "happy path: valid unsigned XDR with allowlisted contract returns { ok: true, hash } and populates cache"
    );

    it.todo(
      "throws 400 INVALID_XDR when unsignedXdr is malformed / cannot parse"
    );

    it.todo(
      "in production, op targeting disallowed contractId throws 422 with generic PREPARE_REJECTED (no contractId in body)"
    );

    it.todo(
      "in development, op targeting disallowed contractId throws 422 DISALLOWED_CONTRACT with { details: { contractId } } in body"
    );

    it.todo(
      "non-invoke op (ManageData, PathPayment, etc.) throws 422 DISALLOWED_OPERATION"
    );

    it.todo(
      "second prepare() call for the same sourceAccount overwrites the cache entry (last-write-wins)"
    );

    it.todo(
      "logs structured event tx_prepared with { traceId, ip, sourceAccount, hash, opsCount, durationMs }"
    );

    it.todo(
      "logs structured event prepare_rejected with { traceId, ip, reason } on validator failure"
    );
  });

  describe("submit()", () => {
    it.todo(
      "happy path: signed XDR matches cached prepare, RPC sendTransaction succeeds, poll resolves SUCCESS → returns { status: 'SUCCESS', hash, traceId, returnValue? }"
    );

    it.todo(
      "cache miss (prepare expired / never called) → throws 403 SUBMIT_REJECTED with traceId"
    );

    it.todo(
      "hash mismatch (cached.hash !== recomputedHash) → throws 403 SUBMIT_REJECTED"
    );

    it.todo(
      "passphrase mismatch (cached.passphrase !== service passphrase) → throws 403 SUBMIT_REJECTED"
    );

    it.todo(
      "source account spoofing (tx.source !== cached.sourceAccount) → throws 403 SUBMIT_REJECTED"
    );

    it.todo(
      "consume is one-shot: replay of the same signedXdr immediately returns 403 SUBMIT_REJECTED on second call"
    );

    it.todo(
      "RPC sendTransaction returns ERROR → throws mapped HttpException via SorobanErrorMapper.mapSendError"
    );

    it.todo(
      "poll timeout (25s elapsed without terminal status) → returns { status: 'PENDING', hash, traceId } with 200"
    );

    it.todo(
      "polling: returns terminal FAILED status with mapped error when getTransaction resolves FAILED before timeout"
    );

    it.todo(
      "logs submit_accepted on cache validation, then submit_resolved with { status, durationMs }"
    );

    it.todo(
      "logs submit_rejected with { reason } (e.g. 'hash_mismatch') but body returned to client is generic"
    );

    it.todo(
      "throws 400 INVALID_XDR when signed XDR cannot be parsed"
    );
  });

  describe("getStatus(hash)", () => {
    it.todo(
      "known hash with SUCCESS in RPC → returns { status: 'SUCCESS', hash, returnValue }"
    );

    it.todo(
      "known hash still pending in RPC → returns { status: 'PENDING', hash }"
    );

    it.todo(
      "known hash with FAILED in RPC → returns { status: 'FAILED', hash, error }"
    );

    it.todo(
      "unknown hash → returns { status: 'PENDING', hash } (RPC has not yet ingested or 404)"
    );
  });
});
