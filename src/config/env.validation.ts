import * as Joi from "joi";

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
  STELLAR_RPC_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  STELLAR_HORIZON_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  STELLAR_RPC_AUTH_HEADER: Joi.string().optional().allow(""),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().min(1).required(),

  CORS_ORIGIN: Joi.string().optional().allow(""),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10).default(0),

  INTERNAL_API_KEY: Joi.string().min(32).required(),

  SOROSWAP_API_KEY: Joi.string().optional().allow(""),

  VAULT_MANAGER_SECRET_KEY: Joi.string()
    .pattern(/^S[A-Z2-7]{55}$/)
    .optional()
    .allow(""),
  DEFINDEX_API_KEY: Joi.string().optional().allow(""),
});
