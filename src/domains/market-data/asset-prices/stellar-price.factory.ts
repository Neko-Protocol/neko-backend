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

const REFLECTOR_CONTRACT_ID =
  "CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M";

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

export function createStellarPriceService(
  config: ConfigService
): StellarPriceService {
  const logger = new Logger("StellarPriceServiceFactory");

  const stellarNetwork = config.get<string>("STELLAR_NETWORK") ?? "mainnet";
  const passphrase = config.get<string>("STELLAR_NETWORK_PASSPHRASE") ?? "";
  const rpcUrl = config.get<string>("STELLAR_RPC_URL") ?? "";
  const networkId = getCurrentNetworkId(stellarNetwork);

  const reflectorClient = buildReflectorClient(
    stellarNetwork,
    passphrase,
    rpcUrl,
    logger
  );
  if (!reflectorClient) {
    logger.warn(
      `Reflector client unavailable for network=${stellarNetwork}; prices will fall back to xBull Swap/CoinGecko.`
    );
  }

  const deps: StellarPriceServiceDeps = {
    getSwapKitUsdPrice: async (contractAddress, decimals) => {
      const usdc = getAssetsConfig(networkId).USDC;
      if (!usdc?.contract) return 0;
      try {
        const query = new URLSearchParams({
          fromAsset: contractAddress,
          toAsset: usdc.contract,
          amount: (10n ** BigInt(decimals)).toString(),
        });
        const response = await fetch(
          `https://swap-api.xbull.io/swaps/quote?${query}`
        );
        if (!response.ok) return 0;
        const quote = (await response.json()) as { toAmount?: string };
        return Number(quote.toAmount ?? 0) / 10 ** usdc.decimals;
      } catch {
        return 0;
      }
    },
    getReflectorClient: () => reflectorClient,
    getAssetConfig: (code: string) => getAssetsConfig(networkId)[code],
  };

  return new StellarPriceService(deps);
}
