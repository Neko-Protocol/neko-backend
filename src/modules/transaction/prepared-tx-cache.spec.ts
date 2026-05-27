import { PreparedTxCache } from "./prepared-tx-cache";

const SOURCE_A = "GA000000000000000000000000000000000000000000000000000000A";
const SOURCE_B = "GA000000000000000000000000000000000000000000000000000000B";
const PASSPHRASE = "Test SDF Network ; September 2015";

function makeEntry(hash: string) {
  return { hash, passphrase: PASSPHRASE };
}

describe("PreparedTxCache", () => {
  let cache: PreparedTxCache;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("set + get", () => {
    it("set then peek within TTL returns the entry", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));

      const entry = cache.peek(SOURCE_A);

      expect(entry).toBeDefined();
      expect(entry?.hash).toBe("hash-1");
      expect(entry?.sourceAccount).toBe(SOURCE_A);
      expect(entry?.passphrase).toBe(PASSPHRASE);
    });

    it("set then peek after TTL expiry returns undefined", () => {
      cache = new PreparedTxCache({ ttlMs: 120_000 });
      cache.set(SOURCE_A, makeEntry("hash-1"));

      jest.advanceTimersByTime(120_001);

      expect(cache.peek(SOURCE_A)).toBeUndefined();
    });

    it("set overwrites the existing entry for the same sourceAccount (last-write-wins)", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));
      cache.set(SOURCE_A, makeEntry("hash-2"));

      expect(cache.peek(SOURCE_A)?.hash).toBe("hash-2");
      expect(cache.size()).toBe(1);
    });

    it("set returns a fully-populated entry with sourceAccount and expiresAt", () => {
      cache = new PreparedTxCache({ ttlMs: 60_000 });
      const result = cache.set(SOURCE_A, makeEntry("hash-1"));

      expect(result.hash).toBe("hash-1");
      expect(result.sourceAccount).toBe(SOURCE_A);
      expect(result.passphrase).toBe(PASSPHRASE);
      expect(result.expiresAt).toBe(Date.now() + 60_000);
    });
  });

  describe("consume (one-shot)", () => {
    it("set then consume returns the entry on first call", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));

      const entry = cache.consume(SOURCE_A);

      expect(entry?.hash).toBe("hash-1");
    });

    it("set then consume twice: second call returns undefined", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));

      expect(cache.consume(SOURCE_A)).toBeDefined();
      expect(cache.consume(SOURCE_A)).toBeUndefined();
    });

    it("consume removes the entry even though it was unused (one-shot)", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));

      cache.consume(SOURCE_A);

      expect(cache.size()).toBe(0);
    });

    it("consume after TTL expiry returns undefined and does not return a stale entry", () => {
      cache = new PreparedTxCache({ ttlMs: 120_000 });
      cache.set(SOURCE_A, makeEntry("hash-1"));

      jest.advanceTimersByTime(120_001);

      expect(cache.consume(SOURCE_A)).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it("consume of a missing sourceAccount returns undefined", () => {
      cache = new PreparedTxCache();
      expect(cache.consume(SOURCE_A)).toBeUndefined();
    });
  });

  describe("TTL expiry", () => {
    it("entry set with default TTL=120s is unavailable after advancing past 120_000ms", () => {
      cache = new PreparedTxCache();
      cache.set(SOURCE_A, makeEntry("hash-1"));

      jest.advanceTimersByTime(120_001);

      expect(cache.peek(SOURCE_A)).toBeUndefined();
    });

    it("entry remains available just before TTL expiry", () => {
      cache = new PreparedTxCache({ ttlMs: 120_000 });
      cache.set(SOURCE_A, makeEntry("hash-1"));

      jest.advanceTimersByTime(119_999);

      expect(cache.peek(SOURCE_A)).toBeDefined();
    });

    it("peek of an expired entry deletes it lazily", () => {
      cache = new PreparedTxCache({ ttlMs: 120_000 });
      cache.set(SOURCE_A, makeEntry("hash-1"));

      jest.advanceTimersByTime(120_001);
      cache.peek(SOURCE_A);

      expect(cache.size()).toBe(0);
    });
  });

  describe("max-size eviction", () => {
    it("filling cache to maxSize keeps size === maxSize", () => {
      cache = new PreparedTxCache({ maxSize: 5 });

      for (let i = 0; i < 5; i++) {
        cache.set(`G${i}`, makeEntry(`hash-${i}`));
      }

      expect(cache.size()).toBe(5);
    });

    it("when full, set() of a new key evicts the oldest insertion first", () => {
      cache = new PreparedTxCache({ maxSize: 3 });

      cache.set("G0", makeEntry("hash-0"));
      cache.set("G1", makeEntry("hash-1"));
      cache.set("G2", makeEntry("hash-2"));
      cache.set("G3", makeEntry("hash-3"));

      expect(cache.size()).toBe(3);
      expect(cache.peek("G0")).toBeUndefined();
      expect(cache.peek("G1")).toBeDefined();
      expect(cache.peek("G2")).toBeDefined();
      expect(cache.peek("G3")).toBeDefined();
    });

    it("eviction prefers expired entries before evicting by age", () => {
      cache = new PreparedTxCache({ maxSize: 3, ttlMs: 1_000 });

      cache.set("G0", makeEntry("hash-0"));
      cache.set("G1", makeEntry("hash-1"));
      cache.set("G2", makeEntry("hash-2"));

      jest.advanceTimersByTime(2_000);
      cache.set("G3", makeEntry("hash-3"));

      expect(cache.peek("G0")).toBeUndefined();
      expect(cache.peek("G1")).toBeUndefined();
      expect(cache.peek("G2")).toBeUndefined();
      expect(cache.peek("G3")).toBeDefined();
    });

    it("after eviction, the freshly-inserted entry remains", () => {
      cache = new PreparedTxCache({ maxSize: 2 });

      cache.set(SOURCE_A, makeEntry("hash-a"));
      cache.set(SOURCE_B, makeEntry("hash-b"));
      cache.set("G_NEW", makeEntry("hash-new"));

      expect(cache.peek("G_NEW")?.hash).toBe("hash-new");
    });
  });
});
