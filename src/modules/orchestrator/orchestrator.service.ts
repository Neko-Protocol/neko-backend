import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createOrchestrator,
  setContractErrorExtractor,
  type CreatedOrchestrator,
  type StellarNetworkId,
} from "@neko/orchestrator";

function mapNetwork(raw: string | undefined): StellarNetworkId {
  const n = (raw ?? "").toLowerCase();
  if (n === "mainnet" || n === "public" || n === "pubnet") return "PUBLIC";
  if (n === "testnet") return "TESTNET";
  if (n === "futurenet") return "FUTURENET";
  if (n === "local") return "LOCAL";
  return "PUBLIC";
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly built: CreatedOrchestrator;

  constructor(config: ConfigService) {
    setContractErrorExtractor((cause) =>
      cause instanceof Error ? cause.message : String(cause ?? "")
    );
    const networkId = mapNetwork(config.get<string>("STELLAR_NETWORK"));
    const rpcUrl = config.getOrThrow<string>("STELLAR_RPC_URL");
    const passphrase = config.getOrThrow<string>("STELLAR_NETWORK_PASSPHRASE");
    const horizonUrl = config.get<string>("STELLAR_HORIZON_URL");

    this.built = createOrchestrator({
      network: {
        id: networkId,
        rpcUrl,
        passphrase,
        horizonUrl,
        allowHttp: rpcUrl.startsWith("http://"),
      },
      contractToCodeMap: {},
    });

    this.logger.log(
      `Orchestrator initialised for ${networkId} with ${this.built.poolRegistry.getAdapters().length} adapters`
    );
  }

  get orchestrator() {
    return this.built.orchestrator;
  }

  get poolRegistry() {
    return this.built.poolRegistry;
  }
}
