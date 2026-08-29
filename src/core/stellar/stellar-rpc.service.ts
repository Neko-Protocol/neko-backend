import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Horizon, rpc, Transaction } from "@stellar/stellar-sdk";
import { RpcClientService } from "../rpc/rpc-client.service";
import { RpcPoolService } from "../rpc/rpc-pool.service";
import {
  loadStellarNetworkConfig,
  StellarNetworkConfig,
} from "./stellar-network.config";

/**
 * Properties on rpc.Server that are plain data rather than callable methods.
 * They are read straight off the highest-priority endpoint's client.
 */
const PASSTHROUGH_PROPS = new Set(["serverURL", "allowHttp", "headers"]);

@Injectable()
export class StellarRpcService implements OnModuleInit {
  private readonly logger = new Logger(StellarRpcService.name);
  private _config!: StellarNetworkConfig;
  private _horizon!: Horizon.Server;
  private _rpcProxy!: rpc.Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly pool: RpcPoolService,
    private readonly client: RpcClientService
  ) {}

  onModuleInit() {
    this._config = loadStellarNetworkConfig(this.configService);
    this._horizon = new Horizon.Server(this._config.horizonUrl);
    this._rpcProxy = this.buildProxy();

    this.logger.log(
      `Stellar RPC initialized network=${this._config.network} endpoints=${this.pool
        .all()
        .map((e) => e.config.label)
        .join(",")}`
    );
  }

  /**
   * Looks and behaves like an `rpc.Server`, but every method call is routed
   * through the pool so it gains health-aware endpoint selection, retry with
   * backoff, and failover. Existing consumers need no changes.
   */
  get rpc(): rpc.Server {
    return this._rpcProxy;
  }

  get horizon(): Horizon.Server {
    return this._horizon;
  }

  getNetworkPassphrase(): string {
    return this._config.passphrase;
  }

  getNetwork(): string {
    return this._config.network;
  }

  /** URL of the highest-priority endpoint, safe to log (no credentials). */
  getSafeRpcUrl(): string {
    return this.pool.all()[0]?.config.url ?? "";
  }

  sendTransaction(tx: Transaction) {
    return this.rpc.sendTransaction(tx);
  }

  getTransaction(hash: string) {
    return this.rpc.getTransaction(hash);
  }

  private buildProxy(): rpc.Server {
    const client = this.client;
    const pool = this.pool;

    return new Proxy({} as rpc.Server, {
      get(_target, prop) {
        // `await server` probes for a thenable — returning a function here
        // would make the proxy look like a promise and hang the caller.
        if (prop === "then") return undefined;
        if (typeof prop === "symbol") return undefined;

        if (PASSTHROUGH_PROPS.has(prop)) {
          const primary = pool.all()[0];
          return primary
            ? (primary.server as unknown as Record<string, unknown>)[prop]
            : undefined;
        }

        return (...args: unknown[]) => client.call(prop, args);
      },
    });
  }
}
