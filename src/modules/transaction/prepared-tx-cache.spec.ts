describe("PreparedTxCache", () => {
  describe("set + get", () => {
    it.todo(
      "set then get within TTL returns the entry"
    );

    it.todo(
      "set then get after TTL expiry returns undefined"
    );

    it.todo(
      "set overwrites the existing entry for the same sourceAccount (last-write-wins)"
    );
  });

  describe("consume (one-shot)", () => {
    it.todo(
      "set then consume returns the entry on first call"
    );

    it.todo(
      "set then consume twice: second call returns undefined"
    );

    it.todo(
      "consume after TTL expiry returns undefined and does not return a stale entry"
    );
  });

  describe("TTL expiry", () => {
    it.todo(
      "entry set with TTL=120s is unavailable after advancing fake timers past 120_000ms"
    );

    it.todo(
      "cleanup interval removes expired entries proactively (size shrinks without explicit get)"
    );
  });

  describe("max-size eviction", () => {
    it.todo(
      "with maxSize=10000, filling the cache to capacity does not throw; size === maxSize"
    );

    it.todo(
      "when full, set() of a new key evicts the entry with the closest expiresAt (LRU-by-TTL)"
    );

    it.todo(
      "after eviction, the evicted key's get/consume returns undefined while non-evicted keys remain"
    );

    it.todo(
      "eviction never removes a freshly-inserted entry; only stale (closest-to-expiry) entries are evicted"
    );
  });
});
