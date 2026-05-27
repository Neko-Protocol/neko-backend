import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Horizon, rpc, Transaction } from "@stellar/stellar-sdk";
import {
  loadStellarNetworkConfig,
  StellarNetworkConfig,
} from "./stellar-network.config";

/**
 * Parses an RPC URL and isolates basic-auth credentials from the host,
 * so the raw URL with credentials is never logged.
 */
function isolateUrlCredentials(rawUrl: string): {
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

@Injectable()
export class StellarRpcService implements OnModuleInit {
  private readonly logger = new Logger(StellarRpcService.name);
  private _config!: StellarNetworkConfig;
  private _rpc!: rpc.Server;
  private _horizon!: Horizon.Server;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this._config = loadStellarNetworkConfig(this.configService);

    const { safeUrl, authHeader } = isolateUrlCredentials(this._config.rpcUrl);
    const headers: Record<string, string> = {};
    if (authHeader) headers.Authorization = authHeader;
    if (this._config.rpcAuthHeader) {
      const [name, ...rest] = this._config.rpcAuthHeader.split(":");
      if (name && rest.length) {
        headers[name.trim()] = rest.join(":").trim();
      } else {
        headers.Authorization = this._config.rpcAuthHeader.trim();
      }
    }

    this._rpc = new rpc.Server(safeUrl, {
      allowHttp: safeUrl.startsWith("http://"),
      headers: Object.keys(headers).length ? headers : undefined,
    });
    this._horizon = new Horizon.Server(this._config.horizonUrl);

    this.logger.log(
      `Stellar RPC initialized network=${this._config.network} host=${
        new URL(safeUrl).host
      }`
    );
  }

  getNetworkPassphrase(): string {
    return this._config.passphrase;
  }

  getNetwork(): string {
    return this._config.network;
  }

  get rpc(): rpc.Server {
    return this._rpc;
  }

  get horizon(): Horizon.Server {
    return this._horizon;
  }

  sendTransaction(tx: Transaction) {
    return this._rpc.sendTransaction(tx);
  }

  getTransaction(hash: string) {
    return this._rpc.getTransaction(hash);
  }
}
