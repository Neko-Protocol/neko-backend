import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  StellarPriceService,
  getAssetsConfig,
  getCurrentNetworkId,
  type StellarPriceServiceDeps,
} from "@neko/keeper";
import {
  Client as ReflectorClient,
  type Client as ReflectorClientType,
} from "@neko/reflector";
import { SoroswapSDK, SupportedNetworks } from "@soroswap/sdk";

const REFLECTOR_CONTRACT_ID =
  "CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M";

function soroswapNetworkFor(network: string): SupportedNetworks {
  const lower = network.toLowerCase();
  if (lower === "mainnet" || lower === "public" || lower === "pubnet") {
    return SupportedNetworks.MAINNET;
  }
  return SupportedNetworks.TESTNET;
}

function buildReflectorClient(
  network: string,
  passphrase: string,
  rpcUrl: string,
  logger: Logger
): ReflectorClientType | null {
  const upper = network.toUpperCase();
  if (upper !== "MAINNET" && upper !== "PUBLIC" && upper !== "PUBNET") {
    return null;
  }
  try {
    return new ReflectorClient({
      contractId: REFLECTOR_CONTRACT_ID,
      networkPassphrase: passphrase,
      rpcUrl,
    });
  } catch (err) {
    logger.warn(
      `Reflector client construction failed: ${(err as Error).message}`
    );
    return null;
  }
}

function buildSoroswapSdk(
  apiKey: string | undefined,
  network: SupportedNetworks,
  logger: Logger
): SoroswapSDK | null {
  if (!apiKey || !apiKey.trim()) return null;
  try {
    return new SoroswapSDK({
      apiKey: apiKey.trim(),
      defaultNetwork: network,
    });
  } catch (err) {
    logger.warn(`Soroswap SDK construction failed: ${(err as Error).message}`);
    return null;
  }
}

export function createStellarPriceService(
  config: ConfigService
): StellarPriceService {
  const logger = new Logger("StellarPriceServiceFactory");

  const stellarNetwork = config.get<string>("STELLAR_NETWORK") ?? "mainnet";
  const passphrase = config.get<string>("STELLAR_NETWORK_PASSPHRASE") ?? "";
  const rpcUrl = config.get<string>("STELLAR_RPC_URL") ?? "";
  const soroswapApiKey = config.get<string>("SOROSWAP_API_KEY");
  const networkId = getCurrentNetworkId(stellarNetwork);
  const soroswapNetwork = soroswapNetworkFor(stellarNetwork);

  const reflectorClient = buildReflectorClient(
    stellarNetwork,
    passphrase,
    rpcUrl,
    logger
  );
  const soroswapSdk = buildSoroswapSdk(soroswapApiKey, soroswapNetwork, logger);

  if (!reflectorClient) {
    logger.warn(
      `Reflector client unavailable for network=${stellarNetwork}; reflector-priced assets will fall back to soroswap/coingecko.`
    );
  }
  if (!soroswapSdk) {
    logger.warn(
      "Soroswap SDK unavailable (SOROSWAP_API_KEY missing); soroswap-priced assets will fall back to coingecko."
    );
  }

  const deps: StellarPriceServiceDeps = {
    getSoroswapSDK: () => soroswapSdk,
    getSoroswapApiKey: () => soroswapApiKey ?? null,
    getSoroswapNetwork: () => soroswapNetwork,
    getReflectorClient: () => reflectorClient,
    getAssetConfig: (code: string) => getAssetsConfig(networkId)[code],
  };

  return new StellarPriceService(deps);
}
