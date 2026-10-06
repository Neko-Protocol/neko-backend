import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Address,
  FeeBumpTransaction,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import {
  getContractLabel,
  isAllowedContract,
  isAllowedFunction,
} from "@shared/stellar/allowlist/contract-allowlist";

export type ValidatedOp =
  | { kind: "invoke"; contractId: string; label: string; fnName: string }
  | { kind: "payment"; destination: string; assetCode: string };

export interface ValidatedXdr {
  tx: Transaction;
  hash: string;
  sourceAccount: string;
  passphrase: string;
  ops: ValidatedOp[];
}

const isProd = () => process.env.NODE_ENV === "production";

@Injectable()
export class XdrValidator {
  private readonly logger = new Logger(XdrValidator.name);

  constructor(private readonly rpc: StellarRpcService) {}

  parseAndValidate(rawXdr: string): ValidatedXdr {
    const passphrase = this.rpc.getNetworkPassphrase();

    let tx: Transaction | FeeBumpTransaction;
    try {
      tx = TransactionBuilder.fromXDR(rawXdr, passphrase);
    } catch {
      throw new BadRequestException({ code: ErrorCode.INVALID_XDR });
    }

    if (tx instanceof FeeBumpTransaction) {
      // Fee-bump TXs are not allowed through the relay.
      throw new UnprocessableEntityException({
        code: ErrorCode.DISALLOWED_OPERATION,
      });
    }

    const ops: ValidatedOp[] = [];
    for (const op of tx.operations as Operation[]) {
      ops.push(this.validateOperation(op));
    }

    return {
      tx,
      hash: tx.hash().toString("hex"),
      sourceAccount: tx.source,
      passphrase,
      ops,
    };
  }

  private validateOperation(op: Operation): ValidatedOp {
    if (op.type === "invokeHostFunction") {
      return this.validateInvoke(op as Operation.InvokeHostFunction);
    }
    if (op.type === "payment") {
      const payment = op as Operation.Payment;
      const assetCode = payment.asset.isNative()
        ? "XLM"
        : payment.asset.getCode();
      return {
        kind: "payment",
        destination: payment.destination,
        assetCode,
      };
    }
    throw new UnprocessableEntityException({
      code: ErrorCode.DISALLOWED_OPERATION,
      ...(isProd() ? {} : { details: { opType: op.type } }),
    });
  }

  private validateInvoke(op: Operation.InvokeHostFunction): ValidatedOp {
    const func = op.func;
    if (func.switch().name !== "hostFunctionTypeInvokeContract") {
      throw new UnprocessableEntityException({
        code: ErrorCode.DISALLOWED_OPERATION,
        ...(isProd()
          ? {}
          : { details: { hostFunctionType: func.switch().name } }),
      });
    }

    const invoke = func.invokeContract();
    const contractId = Address.fromScAddress(
      invoke.contractAddress()
    ).toString();

    if (!isAllowedContract(contractId)) {
      this.logger.warn({
        event: "disallowed_contract",
        contractId,
      });
      throw new UnprocessableEntityException(
        isProd()
          ? { code: ErrorCode.PREPARE_REJECTED }
          : { code: ErrorCode.DISALLOWED_CONTRACT, details: { contractId } }
      );
    }

    const fnNameRaw = invoke.functionName();
    const fnName =
      typeof fnNameRaw === "string" ? fnNameRaw : fnNameRaw.toString("utf8");

    if (!isAllowedFunction(fnName)) {
      throw new UnprocessableEntityException(
        isProd()
          ? { code: ErrorCode.PREPARE_REJECTED }
          : {
              code: ErrorCode.DISALLOWED_OPERATION,
              details: { fnName, contractId },
            }
      );
    }

    return {
      kind: "invoke",
      contractId,
      label: getContractLabel(contractId) ?? "unknown",
      fnName,
    };
  }
}
