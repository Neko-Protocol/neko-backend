import { ConfigService } from "@nestjs/config";
import { isolateUrlCredentials, loadRpcEndpoints } from "./rpc-endpoint.config";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("isolateUrlCredentials", () => {
  it("leaves a credential-free URL untouched", () => {
    const { safeUrl, authHeader } = isolateUrlCredentials(
      "https://rpc.example.com/v1"
    );

    expect(safeUrl).toBe("https://rpc.example.com/v1");
    expect(authHeader).toBeUndefined();
  });

  it("moves basic-auth credentials out of the URL and into a header", () => {
    const { safeUrl, authHeader } = isolateUrlCredentials(
      "https://user:secret@rpc.example.com/v1"
    );

    expect(safeUrl).toBe("https://rpc.example.com/v1");
    expect(safeUrl).not.toContain("secret");
    expect(authHeader).toBe(
      `Basic ${Buffer.from("user:secret").toString("base64")}`
    );
  });
});

describe("loadRpcEndpoints", () => {
  describe("legacy fallback", () => {
    it("builds a single endpoint from STELLAR_RPC_URL when the pool is unset", () => {
      const endpoints = loadRpcEndpoints(
        configWith({ STELLAR_RPC_URL: "https://rpc.example.com" })
      );

      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].label).toBe("primary");
      expect(endpoints[0].url).toBe("https://rpc.example.com/");
    });

    it("carries STELLAR_RPC_AUTH_HEADER through as a named header", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_URL: "https://rpc.example.com",
          STELLAR_RPC_AUTH_HEADER: "X-Api-Key: abc123",
        })
      );

      expect(endpoints[0].headers).toEqual({ "X-Api-Key": "abc123" });
    });

    it("treats a bare auth header value as Authorization", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_URL: "https://rpc.example.com",
          STELLAR_RPC_AUTH_HEADER: "Bearer token",
        })
      );

      expect(endpoints[0].headers).toEqual({ Authorization: "Bearer token" });
    });

    it("throws when neither the pool nor the legacy URL is set", () => {
      expect(() => loadRpcEndpoints(configWith({}))).toThrow(
        /STELLAR_RPC_ENDPOINTS/
      );
    });
  });

  describe("pool config", () => {
    it("parses a pool and sorts it by priority", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_ENDPOINTS: JSON.stringify([
            { url: "https://c.example.com", label: "third", priority: 2 },
            { url: "https://a.example.com", label: "first", priority: 0 },
            { url: "https://b.example.com", label: "second", priority: 1 },
          ]),
        })
      );

      expect(endpoints.map((e) => e.label)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });

    it("takes precedence over the legacy single URL", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_URL: "https://legacy.example.com",
          STELLAR_RPC_ENDPOINTS: JSON.stringify([
            { url: "https://pool.example.com", label: "pool" },
          ]),
        })
      );

      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].label).toBe("pool");
    });

    it("derives a label from the host when none is given", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_ENDPOINTS: JSON.stringify([
            { url: "https://rpc.example.com/v1" },
          ]),
        })
      );

      expect(endpoints[0].label).toBe("rpc.example.com");
    });

    it("flags http:// endpoints as allowHttp", () => {
      const endpoints = loadRpcEndpoints(
        configWith({
          STELLAR_RPC_ENDPOINTS: JSON.stringify([
            { url: "http://localhost:8000/rpc", label: "local" },
          ]),
        })
      );

      expect(endpoints[0].allowHttp).toBe(true);
    });

    it("rejects duplicate labels, which would collide as metric keys", () => {
      expect(() =>
        loadRpcEndpoints(
          configWith({
            STELLAR_RPC_ENDPOINTS: JSON.stringify([
              { url: "https://a.example.com", label: "same" },
              { url: "https://b.example.com", label: "same" },
            ]),
          })
        )
      ).toThrow(/duplicate label/);
    });

    it("rejects malformed JSON", () => {
      expect(() =>
        loadRpcEndpoints(configWith({ STELLAR_RPC_ENDPOINTS: "{not json" }))
      ).toThrow(/valid JSON/);
    });

    it("rejects an empty array", () => {
      expect(() =>
        loadRpcEndpoints(configWith({ STELLAR_RPC_ENDPOINTS: "[]" }))
      ).toThrow(/non-empty/);
    });

    it("rejects an entry with no url", () => {
      expect(() =>
        loadRpcEndpoints(
          configWith({
            STELLAR_RPC_ENDPOINTS: JSON.stringify([{ label: "no-url" }]),
          })
        )
      ).toThrow(/missing a string "url"/);
    });
  });
});
