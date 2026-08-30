import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ErrorCode } from "@neko/api-contracts";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  RpcForwarderService,
} from "./client/rpc-forwarder.service";

/**
 * Methods the browser is allowed to call.
 *
 * Deliberately narrow. This route is reachable by anyone who can read the
 * app's JavaScript, so anything not needed by the client is a free service
 * offered to strangers — and the expensive methods are exactly the ones an
 * abuser would reach for.
 */
const ALLOWED_METHODS = new Set([
  "getLatestLedger",
  "getLedgerEntries",
  "getNetwork",
  "getEvents",
  "getTransaction",
  "simulateTransaction",
  "sendTransaction",
]);

/**
 * A JSON-RPC batch is one request that produces N upstream calls, so an
 * uncapped array is an amplification vector.
 */
const MAX_BATCH_SIZE = 5;

@ApiExcludeController()
@Controller({ path: "rpc", version: "1" })
export class RpcController {
  constructor(private readonly forwarder: RpcForwarderService) {}

  /**
   * JSON-RPC passthrough for the browser.
   *
   * Sits behind the global InternalApiKeyGuard, so it is only reachable
   * through the web-app's own proxy route — the browser never holds the key,
   * and provider credentials never leave this process.
   */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async proxy(
    @Body() body: unknown
  ): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    if (Array.isArray(body)) {
      if (body.length === 0) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: "Empty JSON-RPC batch.",
        });
      }
      if (body.length > MAX_BATCH_SIZE) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `JSON-RPC batch limited to ${MAX_BATCH_SIZE} calls.`,
        });
      }
      const requests = body.map((entry) => this.validate(entry));
      return Promise.all(requests.map((r) => this.dispatch(r)));
    }

    return this.dispatch(this.validate(body));
  }

  private validate(entry: unknown): JsonRpcRequest {
    const request = entry as Partial<JsonRpcRequest> | null;

    if (!request || typeof request.method !== "string") {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Malformed JSON-RPC request.",
      });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      throw new ForbiddenException({
        code: ErrorCode.DISALLOWED_OPERATION,
        message: `RPC method "${request.method}" is not available through this endpoint.`,
      });
    }

    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      method: request.method,
      params: request.params,
    };
  }

  private async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      return await this.forwarder.forward(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (/no usable RPC endpoint/.test(message)) {
        throw new ServiceUnavailableException({
          code: ErrorCode.RPC_ERROR,
          message: "No RPC endpoint is currently available.",
        });
      }

      // Upstream rejections come back as a JSON-RPC error rather than an HTTP
      // failure: the SDK on the other side expects to parse an envelope, and
      // a 500 would surface to the user as a network error instead of the
      // actual reason.
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message },
      };
    }
  }
}
