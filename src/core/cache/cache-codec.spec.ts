import { decode, encode } from "./cache-codec";

function roundTrip<T>(value: T): T | undefined {
  const payload = encode(value);
  return payload === null ? undefined : decode<T>(payload);
}

describe("cache codec", () => {
  describe("shapes plain JSON destroys", () => {
    it("rebuilds a Map, which JSON.stringify silently flattens to {}", () => {
      // The bug this exists to prevent: a cached Map came back as a plain
      // object and the caller crashed on .get().
      const original = new Map<string, bigint>([
        ["vault-a", 1_000n],
        ["vault-b", 42n],
      ]);

      const result = roundTrip(original);

      expect(result).toBeInstanceOf(Map);
      expect(result?.get("vault-a")).toBe(1_000n);
      expect(result?.size).toBe(2);
    });

    it("rebuilds a Set", () => {
      const result = roundTrip(new Set(["a", "b"]));

      expect(result).toBeInstanceOf(Set);
      expect(result?.has("a")).toBe(true);
    });

    it("rebuilds a BigInt, which JSON.stringify throws on", () => {
      const result = roundTrip({ pricePerShare: 123456789012345678901n });

      expect(result?.pricePerShare).toBe(123456789012345678901n);
      expect(typeof result?.pricePerShare).toBe("bigint");
    });

    it("handles a Map nested inside an object", () => {
      const result = roundTrip({ stats: new Map([["k", 1n]]) });

      expect(result?.stats).toBeInstanceOf(Map);
      expect(result?.stats.get("k")).toBe(1n);
    });
  });

  describe("ordinary values", () => {
    it("round-trips plain objects and arrays unchanged", () => {
      const value = { a: 1, b: "two", c: [3, { d: true }], e: null };

      expect(roundTrip(value)).toEqual(value);
    });

    it("round-trips a bare array", () => {
      expect(roundTrip([1, "a", { b: 2 }])).toEqual([1, "a", { b: 2 }]);
    });
  });

  describe("values that must not be cached", () => {
    it("refuses a class instance rather than storing it stripped", () => {
      class VaultPosition {
        constructor(readonly id: string) {}
        describe() {
          return this.id;
        }
      }

      // Storing this would hand the next caller an object without describe().
      expect(encode(new VaultPosition("v1"))).toBeNull();
    });

    it("refuses a class instance nested in a plain object", () => {
      class Inner {
        method() {
          return 1;
        }
      }

      expect(encode({ wrapped: new Inner() })).toBeNull();
    });

    it("refuses a circular structure", () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      expect(encode(circular)).toBeNull();
    });

    it("refuses undefined, which stringify drops entirely", () => {
      expect(encode(undefined)).toBeNull();
    });
  });

  describe("decode", () => {
    it("returns undefined on malformed payloads rather than throwing", () => {
      expect(decode("{not json")).toBeUndefined();
    });
  });
});
