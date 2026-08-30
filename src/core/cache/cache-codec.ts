/**
 * JSON codec for cached values.
 *
 * Plain `JSON.stringify` is unsafe as a cache serializer because it fails
 * *silently* on the shapes this codebase actually caches: a `Map` becomes
 * `{}`, a `Set` becomes `{}`, and a `BigInt` throws. Storing `{}` and handing
 * it back is worse than not caching at all — the caller gets an object that
 * looks valid until it calls `.get()` on it.
 *
 * So Map, Set and BigInt are tagged on the way out and rebuilt on the way in,
 * and anything that still cannot round-trip is reported as uncacheable rather
 * than stored in a corrupted form.
 */

const MAP_TAG = "__cache_map__";
const SET_TAG = "__cache_set__";
const BIGINT_TAG = "__cache_bigint__";

function replacer(this: unknown, key: string, value: unknown): unknown {
  // `this[key]` is the pre-toJSON value; `value` has already been converted,
  // which for a Map or Set means it is already an empty object.
  const raw = (this as Record<string, unknown>)?.[key];

  if (raw instanceof Map) {
    return { [MAP_TAG]: Array.from(raw.entries()) };
  }
  if (raw instanceof Set) {
    return { [SET_TAG]: Array.from(raw.values()) };
  }
  if (typeof raw === "bigint") {
    return { [BIGINT_TAG]: raw.toString() };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  const tagged = value as Record<string, unknown>;

  if (Array.isArray(tagged[MAP_TAG])) {
    return new Map(tagged[MAP_TAG] as [unknown, unknown][]);
  }
  if (Array.isArray(tagged[SET_TAG])) {
    return new Set(tagged[SET_TAG] as unknown[]);
  }
  if (typeof tagged[BIGINT_TAG] === "string") {
    return BigInt(tagged[BIGINT_TAG]);
  }
  return value;
}

/**
 * Serializes a value for storage, or returns null when it cannot be
 * represented faithfully. A null result means "do not cache this" — the
 * caller keeps working, it just fetches every time.
 */
export function encode(value: unknown): string | null {
  try {
    const payload = JSON.stringify(value, replacer);
    if (payload === undefined) return null;

    // Class instances beyond the tagged types survive stringify as plain
    // objects and would come back stripped of their methods. Catching that
    // in general is not possible, so the guard is narrow: a value whose
    // prototype is neither Object nor Array is not safe to store.
    if (!isPlainAfterEncoding(value)) return null;

    return payload;
  } catch {
    // BigInt outside a tagged position, circular references, and anything
    // else stringify refuses.
    return null;
  }
}

export function decode<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload, reviver) as T;
  } catch {
    return undefined;
  }
}

/**
 * Rejects values carrying a class instance the codec does not know how to
 * rebuild. Traverses only the top two levels: deeper nesting is rare in what
 * this cache stores, and an exhaustive walk would cost more than the cache
 * saves.
 */
function isPlainAfterEncoding(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== "object") return true;
  if (value instanceof Map || value instanceof Set) {
    if (depth >= 2) return true;
    for (const entry of value instanceof Map ? value.values() : value) {
      if (!isPlainAfterEncoding(entry, depth + 1)) return false;
    }
    return true;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) return true;
    return value.every((v) => isPlainAfterEncoding(v, depth + 1));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  if (depth >= 2) return true;
  return Object.values(value as Record<string, unknown>).every((v) =>
    isPlainAfterEncoding(v, depth + 1)
  );
}
