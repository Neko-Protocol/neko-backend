import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
} from "@nestjs/common";
import {
  Account,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";
import { PreparedTxCache } from "./prepared-tx-cache";
import { TransactionService } from "./transaction.service";
import { XdrValidator } from "./xdr-validator";
import { StellarRpcService } from "../stellar/stellar-rpc.service";

const PASSPHRASE = Networks.PUBLIC;
const ALLOWED_BLEND_POOL =
  "CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI";
const IP = "127.0.0.1";

function buildUnsignedXdr() {
  const account = new Account(Keypair.random().publicKey(), "0");
  const op = new Contract(ALLOWED_BLEND_POOL).call("deposit");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  return {
    xdr: tx.toXDR(),
    sourceAccount: account.accountId(),
    hash: tx.hash().toString("hex"),
  };
}

interface MockedRpc {
  service: StellarRpcService;
  sendTransaction: jest.Mock;
  getTransaction: jest.Mock;
}

function makeRpcMock(): MockedRpc {
  const sendTransaction = jest.fn();
  const getTransaction = jest.fn();
  const service = {
    getNetworkPassphrase: () => PASSPHRASE,
    sendTransaction,
    getTransaction,
  } as unknown as StellarRpcService;
  return { service, sendTransaction, getTransaction };
}

function successResponse(
  returnValue?: xdr.ScVal
): rpc.Api.GetSuccessfulTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    returnValue,
  } as unknown as rpc.Api.GetSuccessfulTransactionResponse;
}

function notFoundResponse(): rpc.Api.GetMissingTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.NOT_FOUND,
  } as unknown as rpc.Api.GetMissingTransactionResponse;
}

function failedResponse(): rpc.Api.GetFailedTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.FAILED,
    resultXdr: {
      toXDR: () => "RESULT_XDR_BASE64",
    },
  } as unknown as rpc.Api.GetFailedTransactionResponse;
}

function pendingSendResponse(hash: string): rpc.Api.SendTransactionResponse {
  return {
    status: "PENDING",
    hash,
  } as rpc.Api.SendTransactionResponse;
}

function errorSendResponse(hash: string): rpc.Api.SendTransactionResponse {
  return {
    status: "ERROR",
    hash,
    errorResult: { toXDR: () => "ERR_BASE64" },
  } as unknown as rpc.Api.SendTransactionResponse;
}

function duplicateSendResponse(hash: string): rpc.Api.SendTransactionResponse {
  return {
    status: "DUPLICATE",
    hash,
  } as unknown as rpc.Api.SendTransactionResponse;
}

describe("TransactionService", () => {
  let rpcMock: MockedRpc;
  let cache: PreparedTxCache;
  let validator: XdrValidator;
  let mapper: SorobanErrorMapper;
  let service: TransactionService;
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    rpcMock = makeRpcMock();
    cache = new PreparedTxCache();
    validator = new XdrValidator(rpcMock.service);
    mapper = new SorobanErrorMapper();
    service = new TransactionService(rpcMock.service, validator, cache, mapper);
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  describe("prepare()", () => {
    it("happy path: valid unsigned XDR with allowlisted contract returns { ok, hash } and populates cache", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();

      const result = await service.prepare({ unsignedXdr: xdr }, IP);

      expect(result).toEqual({ ok: true, hash });
      const cached = cache.peek(sourceAccount);
      expect(cached?.hash).toBe(hash);
      expect(cached?.passphrase).toBe(PASSPHRASE);
    });

    it("malformed XDR → BadRequestException INVALID_XDR", async () => {
      await expect(
        service.prepare({ unsignedXdr: "garbage" }, IP)
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("second prepare() call for the same sourceAccount overwrites the cache (last-write-wins)", async () => {
      const account = new Account(Keypair.random().publicKey(), "0");
      const buildFor = (fnName: string) =>
        new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: PASSPHRASE,
        })
          .addOperation(new Contract(ALLOWED_BLEND_POOL).call(fnName))
          .setTimeout(30)
          .build();
      const tx1 = buildFor("deposit");
      // Bump account sequence so the second tx has a different hash.
      account.incrementSequenceNumber();
      const tx2 = buildFor("deposit");

      await service.prepare({ unsignedXdr: tx1.toXDR() }, IP);
      await service.prepare({ unsignedXdr: tx2.toXDR() }, IP);

      const cached = cache.peek(account.accountId());
      expect(cached?.hash).toBe(tx2.hash().toString("hex"));
      expect(cache.size()).toBe(1);
    });

    it("in production, disallowed contract op returns generic PREPARE_REJECTED with no contractId in body", async () => {
      process.env.NODE_ENV = "production";
      const account = new Account(Keypair.random().publicKey(), "0");
      const disallowed = "C" + "B".repeat(55);
      // Build via a contract that won't be in the allowlist — use a manual ID.
      const op = new Contract(
        "CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW"
      ).call("deposit");
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();

      try {
        await service.prepare({ unsignedXdr: tx.toXDR() }, IP);
        fail("expected to throw");
      } catch (err) {
        const body = (err as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(body.code).toBe("PREPARE_REJECTED");
        expect(body.details).toBeUndefined();
      }
      // unused-variable guard
      void disallowed;
    });
  });

  describe("submit()", () => {
    it("happy path: cached entry matches, sendTransaction PENDING, poll → SUCCESS", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });

      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      const result = await service.submit({ signedXdr: xdr }, IP);

      expect(result.status).toBe("SUCCESS");
      expect(result.hash).toBe(hash);
      expect(result.traceId).toBeDefined();
    });

    it("happy path: returnValue is base64-encoded when present", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });

      const returnVal = xdr.constructor as never;
      // Use a real ScVal so .toXDR works.
      const scVal = (await import("@stellar/stellar-sdk")).xdr.ScVal.scvU32(42);
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse(scVal));

      const result = await service.submit({ signedXdr: xdr }, IP);

      expect(result.status).toBe("SUCCESS");
      expect(typeof result.returnValue).toBe("string");
      void returnVal;
    });

    it("cache miss → ForbiddenException SUBMIT_REJECTED with traceId", async () => {
      const { xdr } = buildUnsignedXdr();

      try {
        await service.submit({ signedXdr: xdr }, IP);
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as {
          code: string;
          traceId: string;
        };
        expect(body.code).toBe("SUBMIT_REJECTED");
        expect(body.traceId).toBeDefined();
      }
    });

    it("hash mismatch → SUBMIT_REJECTED", async () => {
      const { xdr, sourceAccount } = buildUnsignedXdr();
      cache.set(sourceAccount, {
        hash: "f".repeat(64),
        passphrase: PASSPHRASE,
      });

      await expect(
        service.submit({ signedXdr: xdr }, IP)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("passphrase mismatch → SUBMIT_REJECTED", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, {
        hash,
        passphrase: Networks.TESTNET,
      });

      await expect(
        service.submit({ signedXdr: xdr }, IP)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("source spoofing: XDR's source has no cache entry → SUBMIT_REJECTED", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      const otherSource = Keypair.random().publicKey();
      cache.set(otherSource, { hash, passphrase: PASSPHRASE });

      await expect(
        service.submit({ signedXdr: xdr }, IP)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cache.peek(sourceAccount)).toBeUndefined();
    });

    it("one-shot consume: replay of same signedXdr returns SUBMIT_REJECTED on second call", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      await service.submit({ signedXdr: xdr }, IP);

      await expect(
        service.submit({ signedXdr: xdr }, IP)
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("malformed signed XDR → BadRequestException INVALID_XDR", async () => {
      try {
        await service.submit({ signedXdr: "garbage" }, IP);
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as {
          code: string;
          traceId: string;
        };
        expect(body.code).toBe("INVALID_XDR");
        expect(body.traceId).toBeDefined();
      }
    });

    it("RPC sendTransaction throws → mapped HttpException via SorobanErrorMapper", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockRejectedValue(new Error("tx_bad_seq"));

      try {
        await service.submit({ signedXdr: xdr }, IP);
        fail("expected to throw");
      } catch (err) {
        const body = (err as HttpException).getResponse() as { code: string };
        expect(body.code).toBe("BAD_SEQUENCE");
      }
    });

    it("RPC sendTransaction returns ERROR → mapped HttpException", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(errorSendResponse(hash));

      await expect(
        service.submit({ signedXdr: xdr }, IP)
      ).rejects.toBeInstanceOf(HttpException);
    });

    it("DUPLICATE send response → service calls getStatus and returns its result", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(duplicateSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      const result = await service.submit({ signedXdr: xdr }, IP);

      expect(result.status).toBe("SUCCESS");
      expect(rpcMock.sendTransaction).toHaveBeenCalledTimes(1);
      expect(rpcMock.getTransaction).toHaveBeenCalled();
    });

    it("poll timeout (NOT_FOUND for full window) → returns { status: 'PENDING', hash }", async () => {
      jest.useFakeTimers();
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(notFoundResponse());

      const promise = service.submit({ signedXdr: xdr }, IP);
      await jest.advanceTimersByTimeAsync(26_000);
      const result = await promise;

      expect(result.status).toBe("PENDING");
      expect(result.hash).toBe(hash);
    });

    it("poll returns terminal FAILED → returns { status: 'FAILED', hash, error }", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(failedResponse());

      const result = await service.submit({ signedXdr: xdr }, IP);

      expect(result.status).toBe("FAILED");
      expect(result.error?.code).toBe("TRANSACTION_FAILED");
    });

    it("FeeBumpTransaction → ForbiddenException SUBMIT_REJECTED (fee bumps are blocked)", async () => {
      const innerKp = Keypair.random();
      const innerAccount = new Account(innerKp.publicKey(), "0");
      const innerTx = new TransactionBuilder(innerAccount, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(new Contract(ALLOWED_BLEND_POOL).call("deposit"))
        .setTimeout(30)
        .build();
      innerTx.sign(innerKp);
      const feeBumpKp = Keypair.random();
      const feeBump = TransactionBuilder.buildFeeBumpTransaction(
        feeBumpKp.publicKey(),
        (Number(BASE_FEE) * 10).toString(),
        innerTx,
        PASSPHRASE
      );
      expect(feeBump).toBeInstanceOf(FeeBumpTransaction);

      try {
        await service.submit({ signedXdr: feeBump.toXDR() }, IP);
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as {
          code: string;
        };
        expect(body.code).toBe("SUBMIT_REJECTED");
      }
    });

    it("poll loop tolerates transient getTransaction errors and resolves on a later success", async () => {
      jest.useFakeTimers();
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction
        .mockRejectedValueOnce(new Error("transient rpc"))
        .mockResolvedValueOnce(notFoundResponse())
        .mockResolvedValueOnce(successResponse());

      const promise = service.submit({ signedXdr: xdr }, IP);
      await jest.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.status).toBe("SUCCESS");
      expect(rpcMock.getTransaction).toHaveBeenCalledTimes(3);
    });

    it("RPC sendTransaction throws a non-Error value → still mapped via SorobanErrorMapper", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockRejectedValue("tx_bad_seq");

      try {
        await service.submit({ signedXdr: xdr }, IP);
        fail("expected to throw");
      } catch (err) {
        const body = (err as HttpException).getResponse() as { code: string };
        expect(body.code).toBe("BAD_SEQUENCE");
      }
    });
  });

  describe("getStatus(hash)", () => {
    const HASH = "a".repeat(64);

    it("SUCCESS from RPC → returns { status: 'SUCCESS', hash, returnValue? }", async () => {
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      const result = await service.getStatus(HASH);

      expect(result.status).toBe("SUCCESS");
      expect(result.hash).toBe(HASH);
    });

    it("NOT_FOUND from RPC → returns { status: 'NOT_FOUND', hash, traceId }", async () => {
      rpcMock.getTransaction.mockResolvedValue(notFoundResponse());

      const result = await service.getStatus(HASH);

      expect(result.status).toBe("NOT_FOUND");
      expect(result.hash).toBe(HASH);
    });

    it("FAILED from RPC → returns { status: 'FAILED', hash, error }", async () => {
      rpcMock.getTransaction.mockResolvedValue(failedResponse());

      const result = await service.getStatus(HASH);

      expect(result.status).toBe("FAILED");
      expect(result.error?.code).toBe("TRANSACTION_FAILED");
    });

    it("RPC throws → returns NOT_FOUND with traceId (does not propagate the error)", async () => {
      rpcMock.getTransaction.mockRejectedValue(new Error("rpc down"));

      const result = await service.getStatus(HASH);

      expect(result.status).toBe("NOT_FOUND");
      expect(result.hash).toBe(HASH);
      expect(result.traceId).toBeDefined();
    });

    it("in dev, RPC failure attaches error message; in prod it's stripped", async () => {
      rpcMock.getTransaction.mockRejectedValue(new Error("rpc down"));

      process.env.NODE_ENV = "development";
      const dev = await service.getStatus(HASH);
      expect(dev.error?.code).toBe("RPC_ERROR");
      expect(dev.error?.message).toContain("rpc down");

      process.env.NODE_ENV = "production";
      const prod = await service.getStatus(HASH);
      expect(prod.error).toBeUndefined();
    });
  });
});
