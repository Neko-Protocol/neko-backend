import { parseCorsOrigins } from "./cors-origins";

describe("parseCorsOrigins", () => {
  it("returns no origins when unset or blank", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
    expect(parseCorsOrigins("   ")).toEqual([]);
  });

  it("accepts a single origin", () => {
    expect(parseCorsOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("accepts a comma-separated list and trims entries", () => {
    expect(
      parseCorsOrigins(
        "http://localhost:3000, https://app.nekoprotocol.xyz ,https://www.nekoprotocol.xyz"
      )
    ).toEqual([
      "http://localhost:3000",
      "https://app.nekoprotocol.xyz",
      "https://www.nekoprotocol.xyz",
    ]);
  });

  it("accepts a JSON array of origins", () => {
    expect(
      parseCorsOrigins(
        '["http://localhost:3000","https://app.nekoprotocol.xyz"]'
      )
    ).toEqual(["http://localhost:3000", "https://app.nekoprotocol.xyz"]);
  });

  it("drops a trailing slash so the value matches the browser Origin header", () => {
    expect(parseCorsOrigins("https://app.nekoprotocol.xyz/")).toEqual([
      "https://app.nekoprotocol.xyz",
    ]);
  });

  it("dedupes repeated origins", () => {
    expect(
      parseCorsOrigins(
        "https://app.nekoprotocol.xyz,https://app.nekoprotocol.xyz/"
      )
    ).toEqual(["https://app.nekoprotocol.xyz"]);
  });

  it("rejects a path, query, or non-http scheme", () => {
    expect(() => parseCorsOrigins("https://app.example.com/app")).toThrow(
      /origin/
    );
    expect(() => parseCorsOrigins("https://app.example.com?x=1")).toThrow(
      /origin/
    );
    expect(() => parseCorsOrigins("ws://app.example.com")).toThrow(/http/);
  });

  it("rejects a JSON value that is not an array of strings", () => {
    expect(() => parseCorsOrigins("[not json")).toThrow(/JSON/);
    expect(() => parseCorsOrigins('{"url":"https://app.example.com"}')).toThrow(
      /array/
    );
  });
});
