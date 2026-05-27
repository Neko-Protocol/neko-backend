// SCAFFOLD — feat/lending-tests
//
// Unit tests for PreparedTxCache in PR2 v2 (transaction relay backend).
// Production file: apps/backend/src/modules/transaction/prepared-tx-cache.ts
//
// Decisions validated (tx-relay-backend-plan §2):
//   D2  — In-memory Map<sourceAccount, CacheEntry> with TTL=120s, maxSize=10000
//   D14 — Cache consume is one-shot
//   D17 — maxSize=10000; eviction removes entry with closest expiresAt
//
// Activation (when feat/lending-backend lands PreparedTxCache):
//   1. Replace `it.todo("...")` with real `it("...", () => { ... })`.
//   2. Add imports:
//        import { PreparedTxCache } from "./prepared-tx-cache";
//   3. Use `jest.useFakeTimers()` to control TTL expiry and cleanup interval.
//      Pattern:
//        beforeEach(() => { jest.useFakeTimers(); cache = new PreparedTxCache(); });
//        afterEach(() => { jest.useRealTimers(); cache.onModuleDestroy?.(); });
//   4. CacheEntry shape (per master plan §5.2):
//        { hash: string; passphrase: string; ops: ValidatedOp[]; expiresAt: number }
//   5. Verify coverage >90% per the worktree prompt DoD.

describe("PreparedTxCache", () => {
  describe("set + get", () => {
    it.todo(
      "set then get within TTL returns the entry"
    );

    it.todo(
      "set then get after TTL expiry returns undefined [D2]"
    );

    it.todo(
      "set overwrites the existing entry for the same sourceAccount (last-write-wins) [D2]"
    );
  });

  describe("consume (one-shot)", () => {
    it.todo(
      "set then consume returns the entry on first call [D14]"
    );

    it.todo(
      "set then consume twice: second call returns undefined [D14]"
    );

    it.todo(
      "consume after TTL expiry returns undefined and does not return a stale entry"
    );
  });

  describe("TTL expiry", () => {
    it.todo(
      "entry set with TTL=120s is unavailable after advancing fake timers past 120_000ms [D2]"
    );

    it.todo(
      "cleanup interval removes expired entries proactively (size shrinks without explicit get)"
    );
  });

  describe("max-size eviction (D17)", () => {
    it.todo(
      "with maxSize=10000, filling the cache to capacity does not throw; size === maxSize"
    );

    it.todo(
      "when full, set() of a new key evicts the entry with the closest expiresAt (LRU-by-TTL) [D17]"
    );

    it.todo(
      "after eviction, the evicted key's get/consume returns undefined while non-evicted keys remain"
    );

    it.todo(
      "eviction never removes a freshly-inserted entry; only stale (closest-to-expiry) entries are evicted"
    );
  });
});
