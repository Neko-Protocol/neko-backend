import { ConfigService } from "@nestjs/config";

export interface StellarNetworkConfig {
  network: string;
  passphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  rpcAuthHeader?: string;
}

export function loadStellarNetworkConfig(
  config: ConfigService
): StellarNetworkConfig {
  const network = config.get<string>("STELLAR_NETWORK");
  const passphrase = config.get<string>("STELLAR_NETWORK_PASSPHRASE");
  const rpcUrl = config.get<string>("STELLAR_RPC_URL");
  const horizonUrl = config.get<string>("STELLAR_HORIZON_URL");
  const rpcAuthHeader = config.get<string>("STELLAR_RPC_AUTH_HEADER");

  if (!network || !passphrase || !rpcUrl || !horizonUrl) {
    throw new Error(
      "Missing Stellar configuration: STELLAR_NETWORK, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL, and STELLAR_HORIZON_URL are required."
    );
  }

  return {
    network,
    passphrase,
    rpcUrl,
    horizonUrl,
    rpcAuthHeader,
  };
}
