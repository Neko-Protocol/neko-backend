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
  Operation,
  rpc,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { SorobanErrorMapper } from "./errors/soroban-error.mapper";
import { PreparedTxCache } from "./cache/prepared-tx-cache";
import { DashboardCache } from "@domains/platform/dashboard/cache/dashboard-cache";
import { TransactionService } from "./transaction.service";
import { XdrValidator } from "./validation/xdr-validator";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { SponsorService } from "@core/stellar/sponsor.service";
import { NotificationsService } from "@domains/platform/notifications/notifications.service";
import { ConfigService } from "@nestjs/config";

const PASSPHRASE = Networks.PUBLIC;
const ALLOWED_BLEND_POOL =
  "CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI";
const IP = "127.0.0.1";
const SPONSOR = Keypair.random();

function makeSponsor(
  rpc: StellarRpcService,
  env: Record<string, unknown> = {}
): SponsorService {
  const values: Record<string, unknown> = {
    SPONSOR_SECRET_KEY: SPONSOR.secret(),
    ...env,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new SponsorService(config, rpc);
}

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
  simulateTransaction: jest.Mock;
}

function makeRpcMock(): MockedRpc {
  const sendTransaction = jest.fn();
  const getTransaction = jest.fn();
  const simulateTransaction = jest.fn(async () => ({
    minResourceFee: "50000",
    latestLedger: 1,
  }));
  const service = {
    getNetworkPassphrase: () => PASSPHRASE,
    sendTransaction,
    getTransaction,
    rpc: { simulateTransaction },
  } as unknown as StellarRpcService;
  return { service, sendTransaction, getTransaction, simulateTransaction };
}

function buildSorobanXdr(resourceFee: number) {
  const account = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(new Contract(ALLOWED_BLEND_POOL).call("deposit"))
    .setSorobanData(
      new SorobanDataBuilder().setResourceFee(resourceFee).build()
    )
    .setTimeout(30)
    .build();
  return { xdr: tx.toXDR(), sourceAccount: account.accountId() };
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
  let dashboardCache: { invalidate: jest.Mock };
  let notifications: { emit: jest.Mock };
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    rpcMock = makeRpcMock();
    cache = new PreparedTxCache();
    validator = new XdrValidator(rpcMock.service);
    mapper = new SorobanErrorMapper();
    // The dashboard cache is invalidated after a submit; this suite is about
    // the submit path itself, so it only has to accept the call.
    dashboardCache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new TransactionService(
      rpcMock.service,
      validator,
      cache,
      mapper,
      dashboardCache as unknown as DashboardCache,
      makeSponsor(rpcMock.service),
      notifications as unknown as NotificationsService
    );
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

    it("notifies the signing wallet once a submit settles as SUCCESS", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      await service.submit({ signedXdr: xdr }, IP);

      expect(notifications.emit).toHaveBeenCalledWith({
        trigger: "tx_confirmed",
        walletAddress: sourceAccount,
        dedupeKey: `tx:${hash}`,
        params: { hash },
      });
    });

    it("does not notify when the transaction fails", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(failedResponse());

      await service.submit({ signedXdr: xdr }, IP);

      expect(notifications.emit).not.toHaveBeenCalled();
    });

    // A wallet that just moved funds must not be served its pre-transaction
    // positions; the dashboard cache holds them for two minutes otherwise.
    it("drops the wallet's cached dashboard positions after a settled submit", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      await service.submit({ signedXdr: xdr }, IP);

      expect(dashboardCache.invalidate).toHaveBeenCalledWith(
        `positions:${sourceAccount}`
      );
      expect(dashboardCache.invalidate).toHaveBeenCalledWith(
        `vault-positions:${sourceAccount}`
      );
    });

    it("still returns the result when invalidation fails", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });
      rpcMock.sendTransaction.mockResolvedValue(pendingSendResponse(hash));
      rpcMock.getTransaction.mockResolvedValue(successResponse());
      dashboardCache.invalidate.mockRejectedValue(new Error("redis down"));

      const result = await service.submit({ signedXdr: xdr }, IP);

      expect(result.status).toBe("SUCCESS");
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

  describe("sponsored relay (sponsorFor)", () => {
    it("prepare rejects a source that is not the caller's wallet", async () => {
      const { xdr } = buildUnsignedXdr();
      await expect(
        service.prepare({ unsignedXdr: xdr }, IP, undefined, {
          sponsorFor: Keypair.random().publicKey(),
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("prepare refuses to sponsor plain payments", async () => {
      const account = new Account(Keypair.random().publicKey(), "0");
      const payment = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: (await import("@stellar/stellar-sdk")).Asset.native(),
            amount: "1",
          })
        )
        .setTimeout(30)
        .build();
      await expect(
        service.prepare({ unsignedXdr: payment.toXDR() }, IP, undefined, {
          sponsorFor: account.accountId(),
        })
      ).rejects.toMatchObject({ response: { code: "DISALLOWED_OPERATION" } });
      expect(rpcMock.simulateTransaction).not.toHaveBeenCalled();
    });

    it("prepare rejects a transaction that fails simulation", async () => {
      rpcMock.simulateTransaction.mockResolvedValueOnce({
        error: "HostError: contract trapped",
        latestLedger: 1,
      });
      const { xdr, sourceAccount } = buildUnsignedXdr();
      await expect(
        service.prepare({ unsignedXdr: xdr }, IP, undefined, {
          sponsorFor: sourceAccount,
        })
      ).rejects.toMatchObject({ response: { code: "SIMULATION_FAILED" } });
      expect(cache.peek(sourceAccount)).toBeUndefined();
    });

    it("prepare rejects a declared resource fee far above the simulation", async () => {
      // Simulation needs 50,000; allowed is 50,000 * 1.5 + 100,000 = 175,000.
      const { xdr, sourceAccount } = buildSorobanXdr(400_000);
      await expect(
        service.prepare({ unsignedXdr: xdr }, IP, undefined, {
          sponsorFor: sourceAccount,
        })
      ).rejects.toMatchObject({ response: { code: "SPONSOR_FEE_TOO_HIGH" } });
    });

    it("prepare accepts a resource fee in line with the simulation", async () => {
      const { xdr, sourceAccount } = buildSorobanXdr(60_000);
      await expect(
        service.prepare({ unsignedXdr: xdr }, IP, undefined, {
          sponsorFor: sourceAccount,
        })
      ).resolves.toMatchObject({ ok: true });
    });

    it("unsponsored prepare does not simulate", async () => {
      const { xdr } = buildUnsignedXdr();
      await service.prepare({ unsignedXdr: xdr }, IP);
      expect(rpcMock.simulateTransaction).not.toHaveBeenCalled();
    });

    it("fee-bump charges the inner resource fee once and the rate per op", async () => {
      const { xdr, sourceAccount } = buildSorobanXdr(60_000);
      await service.prepare({ unsignedXdr: xdr }, IP, undefined, {
        sponsorFor: sourceAccount,
      });
      rpcMock.sendTransaction.mockImplementation(async (tx) => ({
        status: "PENDING",
        hash: tx.hash().toString("hex"),
      }));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      await service.submit({ signedXdr: xdr }, IP, undefined, {
        sponsorFor: sourceAccount,
      });
      const sent = rpcMock.sendTransaction.mock.calls[0][0];
      // 1 op: base fee 100 * (1 + 1) + 60,000 resource fee.
      expect(sent.fee).toBe(String(100 * 2 + 60_000));
    });

    it("submit wraps the signed tx in a sponsor fee-bump", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      await service.prepare({ unsignedXdr: xdr }, IP, undefined, {
        sponsorFor: sourceAccount,
      });
      rpcMock.sendTransaction.mockImplementation(async (tx) => ({
        status: "PENDING",
        hash: tx.hash().toString("hex"),
      }));
      rpcMock.getTransaction.mockResolvedValue(successResponse());

      const result = await service.submit({ signedXdr: xdr }, IP, undefined, {
        sponsorFor: sourceAccount,
      });

      const sent = rpcMock.sendTransaction.mock.calls[0][0];
      expect(sent).toBeInstanceOf(FeeBumpTransaction);
      expect(sent.feeSource).toBe(SPONSOR.publicKey());
      expect(sent.innerTransaction.hash().toString("hex")).toBe(hash);
      expect(sent.signatures).toHaveLength(1);
      expect(result.status).toBe("SUCCESS");
      expect(result.hash).toBe(sent.hash().toString("hex"));
    });

    it("submit rejects another wallet's tx without consuming its cache entry", async () => {
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });

      await expect(
        service.submit({ signedXdr: xdr }, IP, undefined, {
          sponsorFor: Keypair.random().publicKey(),
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(cache.peek(sourceAccount)?.hash).toBe(hash);
      expect(rpcMock.sendTransaction).not.toHaveBeenCalled();
    });

    it("submit refuses when the fee exceeds SPONSOR_MAX_FEE_STROOPS", async () => {
      service = new TransactionService(
        rpcMock.service,
        validator,
        cache,
        mapper,
        dashboardCache as unknown as DashboardCache,
        makeSponsor(rpcMock.service, { SPONSOR_MAX_FEE_STROOPS: 150 }),
        notifications as unknown as NotificationsService
      );
      const { xdr, sourceAccount, hash } = buildUnsignedXdr();
      cache.set(sourceAccount, { hash, passphrase: PASSPHRASE });

      await expect(
        service.submit({ signedXdr: xdr }, IP, undefined, {
          sponsorFor: sourceAccount,
        })
      ).rejects.toMatchObject({
        response: { code: "SPONSOR_FEE_TOO_HIGH" },
      });
      expect(rpcMock.sendTransaction).not.toHaveBeenCalled();
    });

    it("unsponsored submit still rejects client-built fee-bumps", async () => {
      const kp = Keypair.random();
      const inner = TransactionBuilder.fromXDR(
        buildUnsignedXdr().xdr,
        PASSPHRASE
      ) as ReturnType<typeof TransactionBuilder.fromXDR> & { sign: unknown };
      const bump = TransactionBuilder.buildFeeBumpTransaction(
        kp,
        "200",
        inner as Parameters<
          typeof TransactionBuilder.buildFeeBumpTransaction
        >[2],
        PASSPHRASE
      );
      await expect(
        service.submit({ signedXdr: bump.toXDR() }, IP, undefined, {
          sponsorFor: kp.publicKey(),
        })
      ).rejects.toBeInstanceOf(ForbiddenException);
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
