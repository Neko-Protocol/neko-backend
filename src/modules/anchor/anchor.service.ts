import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { StellarRpcService } from "../stellar/stellar-rpc.service";
import { getAnchorClient, isValidProvider } from "./lib";
import type { Anchor } from "./lib/types";

@Injectable()
export class AnchorService {
  constructor(
    private readonly config: ConfigService,
    private readonly stellar: StellarRpcService
  ) {}

  /** Resolve a configured anchor client, validating the provider name. */
  client(provider: string): Anchor {
    if (!isValidProvider(provider)) {
      throw new BadRequestException(`Invalid provider: ${provider}`);
    }
    return getAnchorClient(provider);
  }

  isMainnet(): boolean {
    const net =
      this.config.get<string>("STELLAR_NETWORK")?.trim().toUpperCase() ?? "";
    return net === "MAINNET" || net === "PUBLIC" || net === "PUBNET";
  }

  isConfigured(provider: string): boolean {
    switch (provider) {
      case "etherfuse":
        return Boolean(
          this.config.get<string>("ETHERFUSE_API_KEY") &&
          this.config.get<string>("ETHERFUSE_BASE_URL")
        );
      case "alfredpay":
        return Boolean(
          this.config.get<string>("ALFREDPAY_API_KEY") &&
          this.config.get<string>("ALFREDPAY_API_SECRET") &&
          this.config.get<string>("ALFREDPAY_BASE_URL")
        );
      default:
        return false;
    }
  }

  /**
   * Submit a signed XDR for an off-ramp. Tries Soroban RPC first, falls back to
   * Horizon for classic transactions.
   */
  async submitSignedXdr(
    signedXdr: string,
    transactionId?: string
  ): Promise<{
    success: boolean;
    hash: string;
    status?: string;
    transactionId?: string;
  }> {
    const networkPassphrase = this.stellar.getNetworkPassphrase();
    try {
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      const response = await this.stellar.rpc.sendTransaction(
        tx as Parameters<typeof this.stellar.rpc.sendTransaction>[0]
      );
      return {
        success: true,
        hash: response.hash,
        status: response.status,
        transactionId,
      };
    } catch {
      const response = await this.stellar.horizon.submitTransaction(
        TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as Parameters<
          typeof this.stellar.horizon.submitTransaction
        >[0]
      );
      return { success: true, hash: response.hash, transactionId };
    }
  }
}
