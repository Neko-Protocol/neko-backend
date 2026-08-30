import { Logger } from "@nestjs/common";
import { rpc } from "@stellar/stellar-sdk";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
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
  server: rpc.Server,
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
      // Oracle reads go through the pool like everything else. This one
      // matters most: getReflectorUsdPrice catches and returns 0, so a
      // provider outage here does not raise — prices quietly change source.
      server,
    });
  } catch (err) {
    logger.warn(
      `Reflector client construction failed: ${(err as Error).message}`
    );
    return null;
  }
}

export function createStellarPriceService(
  config: ConfigService,
  stellarRpc: StellarRpcService
): StellarPriceService {
  const logger = new Logger("StellarPriceServiceFactory");

  const stellarNetwork = config.get<string>("STELLAR_NETWORK") ?? "mainnet";
  const passphrase = config.get<string>("STELLAR_NETWORK_PASSPHRASE") ?? "";
  const rpcUrl = config.get<string>("STELLAR_RPC_URL") ?? "";
  const networkId = getCurrentNetworkId(stellarNetwork);

  /**
   * Built on first use, not here.
   *
   * This factory runs while providers are being constructed, and the pool
   * proxy does not exist until StellarRpcService's onModuleInit. Reading it
   * now yields undefined, the SDK quietly falls back to the single-endpoint
   * URL, and the oracle ends up off the pool again — with nothing to show for
   * it, because a failed oracle read returns 0 and the price chain moves on to
   * the next source.
   */
  let reflectorClient: ReflectorClientType | null | undefined;
  const getReflectorClient = () => {
    if (reflectorClient === undefined) {
      reflectorClient = buildReflectorClient(
        stellarNetwork,
        passphrase,
        rpcUrl,
        stellarRpc.rpc,
        logger
      );
      if (!reflectorClient) {
        logger.warn(
          `Reflector client unavailable for network=${stellarNetwork}; prices will fall back to xBull Swap/CoinGecko.`
        );
      }
    }
    return reflectorClient;
  };

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
    getReflectorClient,
    getAssetConfig: (code: string) => getAssetsConfig(networkId)[code],
  };

  return new StellarPriceService(deps);
}
