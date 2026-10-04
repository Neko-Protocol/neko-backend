import * as Joi from "joi";
import { parseCorsOrigins } from "./cors-origins";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  PORT: Joi.number().integer().min(1).max(65535).default(4000),
  LOG_LEVEL: Joi.string()
    .valid("fatal", "error", "warn", "info", "debug", "trace", "silent")
    .default("info"),

  STELLAR_NETWORK: Joi.string()
    .pattern(/^(mainnet|testnet|public|pubnet|local)$/i)
    .required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().min(1).required(),
  // Legacy single-endpoint config. Still honoured as a fallback when
  // STELLAR_RPC_ENDPOINTS is unset, so existing deployments keep booting.
  STELLAR_RPC_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  // JSON array of { url, label?, priority?, authHeader? }, highest priority
  // first. Takes precedence over STELLAR_RPC_URL when present.
  STELLAR_RPC_ENDPOINTS: Joi.string().optional().allow(""),
  STELLAR_HORIZON_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  STELLAR_RPC_AUTH_HEADER: Joi.string().optional().allow(""),

  // Optional. Unset means RPC response caching is disabled and every call
  // goes upstream — the app boots and behaves correctly either way.
  REDIS_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .optional()
    .allow(""),

  // Bearer token Grafana (or any scraper) must present on GET /metrics.
  // Unset disables the endpoint entirely rather than opening it.
  METRICS_SCRAPE_TOKEN: Joi.string().min(24).optional().allow(""),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().min(1).required(),
  SUPABASE_ANON_KEY: Joi.string().min(1).required(),

  // Comma-separated origins, or a JSON array of origin strings. Empty rejects
  // every browser origin. See parseCorsOrigins.
  CORS_ORIGIN: Joi.string()
    .optional()
    .allow("")
    .custom((value: string, helpers) => {
      try {
        parseCorsOrigins(value);
        return value;
      } catch (err) {
        return helpers.message(
          err instanceof Error ? err.message : "Invalid CORS_ORIGIN"
        );
      }
    }),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),

  INTERNAL_API_KEY: Joi.string().min(32).required(),

  VAULT_MANAGER_SECRET_KEY: Joi.string()
    .pattern(/^S[A-Z2-7]{55}$/)
    .optional()
    .allow(""),
  DEFINDEX_API_KEY: Joi.string().optional().allow(""),

  WEB_APP_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .optional()
    .allow(""),
  CRON_SECRET: Joi.string().optional().allow(""),

  // Falls back to the public key of VAULT_MANAGER_SECRET_KEY when unset.
  ADMIN_WALLET_ADDRESS: Joi.string().optional().allow(""),
  RESEND_API_KEY: Joi.string().optional().allow(""),
  RESEND_FROM_EMAIL: Joi.string().default("noreply@nekoprotocol.xyz"),
});
