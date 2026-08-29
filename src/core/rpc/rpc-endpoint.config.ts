import { ConfigService } from "@nestjs/config";

export interface RpcEndpointConfig {
  /** Stable identifier used in logs, metrics labels and health output. */
  label: string;
  /** URL with any basic-auth credentials stripped out. */
  url: string;
  /** Lower wins. Ties are broken by declaration order. */
  priority: number;
  headers: Record<string, string>;
  allowHttp: boolean;
}

interface RawEndpoint {
  url?: unknown;
  label?: unknown;
  priority?: unknown;
  authHeader?: unknown;
}

/**
 * Parses an RPC URL and isolates basic-auth credentials from the host, so the
 * raw URL with credentials is never logged or used as a metrics label.
 */
export function isolateUrlCredentials(rawUrl: string): {
  safeUrl: string;
  authHeader?: string;
} {
  const parsed = new URL(rawUrl);
  if (!parsed.username && !parsed.password) {
    return { safeUrl: parsed.toString() };
  }

  const credentials = `${decodeURIComponent(
    parsed.username
  )}:${decodeURIComponent(parsed.password)}`;
  const authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;

  parsed.username = "";
  parsed.password = "";
  return { safeUrl: parsed.toString(), authHeader };
}

/**
 * `Name: value` sets that header; a bare string is assumed to be an
 * Authorization value. Matches the pre-pool behaviour of
 * STELLAR_RPC_AUTH_HEADER so existing deployments keep working.
 */
function applyAuthHeader(
  headers: Record<string, string>,
  raw: string | undefined
): void {
  if (!raw) return;
  const [name, ...rest] = raw.split(":");
  if (name && rest.length) {
    headers[name.trim()] = rest.join(":").trim();
  } else {
    headers.Authorization = raw.trim();
  }
}

function buildEndpoint(
  rawUrl: string,
  label: string,
  priority: number,
  authHeader: string | undefined
): RpcEndpointConfig {
  const { safeUrl, authHeader: urlAuth } = isolateUrlCredentials(rawUrl);
  const headers: Record<string, string> = {};
  if (urlAuth) headers.Authorization = urlAuth;
  applyAuthHeader(headers, authHeader);

  return {
    label,
    url: safeUrl,
    priority,
    headers,
    allowHttp: safeUrl.startsWith("http://"),
  };
}

/** Falls back to the host when no explicit label is configured. */
function deriveLabel(url: string, index: number): string {
  try {
    return new URL(url).host;
  } catch {
    return `endpoint-${index}`;
  }
}

/**
 * Reads STELLAR_RPC_ENDPOINTS (a JSON array of
 * `{ url, label?, priority?, authHeader? }`) and falls back to the legacy
 * single-endpoint STELLAR_RPC_URL + STELLAR_RPC_AUTH_HEADER pair when it is
 * unset — so deployments that have not been migrated keep booting.
 *
 * Endpoints are returned sorted by priority ascending.
 */
export function loadRpcEndpoints(config: ConfigService): RpcEndpointConfig[] {
  const raw = config.get<string>("STELLAR_RPC_ENDPOINTS");

  if (!raw || !raw.trim()) {
    const url = config.get<string>("STELLAR_RPC_URL");
    if (!url) {
      throw new Error(
        "Missing Stellar RPC configuration: set STELLAR_RPC_ENDPOINTS (JSON array) or STELLAR_RPC_URL."
      );
    }
    return [
      buildEndpoint(
        url,
        "primary",
        0,
        config.get<string>("STELLAR_RPC_AUTH_HEADER")
      ),
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("STELLAR_RPC_ENDPOINTS must be valid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "STELLAR_RPC_ENDPOINTS must be a non-empty JSON array of endpoint objects."
    );
  }

  const seen = new Set<string>();
  const endpoints = parsed.map((entry, index) => {
    const item = entry as RawEndpoint;
    if (typeof item?.url !== "string" || !item.url.trim()) {
      throw new Error(
        `STELLAR_RPC_ENDPOINTS[${index}] is missing a string "url".`
      );
    }

    const label =
      typeof item.label === "string" && item.label.trim()
        ? item.label.trim()
        : deriveLabel(item.url, index);

    if (seen.has(label)) {
      throw new Error(
        `STELLAR_RPC_ENDPOINTS has duplicate label "${label}" — labels are used as metric keys and must be unique.`
      );
    }
    seen.add(label);

    const priority =
      typeof item.priority === "number" && Number.isFinite(item.priority)
        ? item.priority
        : index;

    const authHeader =
      typeof item.authHeader === "string" ? item.authHeader : undefined;

    return buildEndpoint(item.url, label, priority, authHeader);
  });

  return endpoints.sort((a, b) => a.priority - b.priority);
}
