import {
  BadRequestException,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { StellarRpcService } from "@core/stellar/stellar-rpc.service";
import { XdrValidator } from "./xdr-validator";

const PASSPHRASE = Networks.PUBLIC;
const ALLOWED_BLEND_POOL =
  "CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI";
const ALLOWED_VAULT_EURC =
  "CB3FUMFGCF6DHSFK6N2TOKHRMYXS34HFKQR45UKVORCRUM35AF3ES7WQ";
const DISALLOWED_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 0xab));

function makeAccount(): Account {
  return new Account(Keypair.random().publicKey(), "0");
}

function buildXdr(...ops: ReturnType<typeof Operation.payment>[]): {
  xdr: string;
  sourceAccount: string;
} {
  const account = makeAccount();
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.setTimeout(30).build();
  return { xdr: tx.toXDR(), sourceAccount: account.accountId() };
}

function invokeOp(contractId: string, fnName: string) {
  return new Contract(contractId).call(fnName);
}

function buildInvokeXdr(contractId: string, fnName: string) {
  return buildXdr(invokeOp(contractId, fnName) as never);
}

function makeRpcServiceStub(): StellarRpcService {
  return {
    getNetworkPassphrase: () => PASSPHRASE,
  } as unknown as StellarRpcService;
}

describe("XdrValidator.parseAndValidate", () => {
  let validator: XdrValidator;
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    validator = new XdrValidator(makeRpcServiceStub());
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  describe("allowed paths", () => {
    it("valid invokeHostFunction on allowlisted contract with allowed fn returns hash, sourceAccount, passphrase, ops", () => {
      const { xdr, sourceAccount } = buildInvokeXdr(
        ALLOWED_BLEND_POOL,
        "deposit"
      );

      const result = validator.parseAndValidate(xdr);

      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.sourceAccount).toBe(sourceAccount);
      expect(result.passphrase).toBe(PASSPHRASE);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0]).toMatchObject({
        kind: "invoke",
        contractId: ALLOWED_BLEND_POOL,
        fnName: "deposit",
        label: "blend:pool",
      });
    });

    it("supports multiple allowlisted fn names on Blend pool (withdraw, submit)", () => {
      for (const fn of ["withdraw", "submit"]) {
        const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, fn);
        const result = validator.parseAndValidate(xdr);
        expect(result.ops[0]).toMatchObject({ kind: "invoke", fnName: fn });
      }
    });

    it("rejects raw mint/burn/transfer/approve on an asset SAC", () => {
      // Token writes must only appear as nested authorized sub-invocations
      // inside protocol calls (Blend submit, Soroswap swap, etc.), never as
      // top-level ops — see contract-allowlist.ts for the rationale.
      const USDC_SAC =
        "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
      for (const fn of ["mint", "burn", "transfer", "approve"]) {
        const { xdr } = buildInvokeXdr(USDC_SAC, fn);
        expect(() => validator.parseAndValidate(xdr)).toThrow();
      }
    });

    it("Payment op with native XLM passes and returns kind: 'payment'", () => {
      const dest = Keypair.random().publicKey();
      const op = Operation.payment({
        destination: dest,
        asset: Asset.native(),
        amount: "10",
      });
      const { xdr } = buildXdr(op as never);

      const result = validator.parseAndValidate(xdr);

      expect(result.ops[0]).toEqual({
        kind: "payment",
        destination: dest,
        assetCode: "XLM",
      });
    });

    it("Payment op with non-native asset returns its code", () => {
      const dest = Keypair.random().publicKey();
      const issuer = Keypair.random().publicKey();
      const op = Operation.payment({
        destination: dest,
        asset: new Asset("USDC", issuer),
        amount: "10",
      });
      const { xdr } = buildXdr(op as never);

      const result = validator.parseAndValidate(xdr);

      expect(result.ops[0]).toEqual({
        kind: "payment",
        destination: dest,
        assetCode: "USDC",
      });
    });
  });

  describe("disallowed contract", () => {
    it("invoke on contractId NOT in allowlist throws UnprocessableEntityException", () => {
      const { xdr } = buildInvokeXdr(DISALLOWED_CONTRACT, "deposit");
      expect(() => validator.parseAndValidate(xdr)).toThrow(
        UnprocessableEntityException
      );
    });

    it("in NODE_ENV=production, body is { code: PREPARE_REJECTED } with NO contractId leaked", () => {
      process.env.NODE_ENV = "production";
      const { xdr } = buildInvokeXdr(DISALLOWED_CONTRACT, "deposit");

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (
          err as UnprocessableEntityException
        ).getResponse() as Record<string, unknown>;
        expect(body.code).toBe("PREPARE_REJECTED");
        expect(body.details).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(DISALLOWED_CONTRACT);
      }
    });

    it("in NODE_ENV=development, body is { code: DISALLOWED_CONTRACT, details: { contractId } }", () => {
      process.env.NODE_ENV = "development";
      const { xdr } = buildInvokeXdr(DISALLOWED_CONTRACT, "deposit");

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (err as UnprocessableEntityException).getResponse() as {
          code: string;
          details?: { contractId?: string };
        };
        expect(body.code).toBe("DISALLOWED_CONTRACT");
        expect(body.details?.contractId).toBe(DISALLOWED_CONTRACT);
      }
    });
  });

  describe("disallowed operation type", () => {
    it("ManageData op throws DISALLOWED_OPERATION", () => {
      const op = Operation.manageData({
        name: "test",
        value: "value",
      });
      const { xdr } = buildXdr(op as never);

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect(
          (err as UnprocessableEntityException).getResponse()
        ).toMatchObject({ code: "DISALLOWED_OPERATION" });
      }
    });

    it("SetOptions op throws DISALLOWED_OPERATION", () => {
      const op = Operation.setOptions({ homeDomain: "neko.dev" });
      const { xdr } = buildXdr(op as never);

      expect(() => validator.parseAndValidate(xdr)).toThrow(
        UnprocessableEntityException
      );
    });

    it("CreateAccount op throws DISALLOWED_OPERATION", () => {
      const op = Operation.createAccount({
        destination: Keypair.random().publicKey(),
        startingBalance: "100",
      });
      const { xdr } = buildXdr(op as never);

      expect(() => validator.parseAndValidate(xdr)).toThrow(
        UnprocessableEntityException
      );
    });

    it("in NODE_ENV=development, DISALLOWED_OPERATION body includes opType", () => {
      process.env.NODE_ENV = "development";
      const op = Operation.manageData({ name: "x", value: "y" });
      const { xdr } = buildXdr(op as never);

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (err as UnprocessableEntityException).getResponse() as {
          details?: { opType?: string };
        };
        expect(body.details?.opType).toBe("manageData");
      }
    });

    it("in NODE_ENV=production, DISALLOWED_OPERATION body has no opType details", () => {
      process.env.NODE_ENV = "production";
      const op = Operation.manageData({ name: "x", value: "y" });
      const { xdr } = buildXdr(op as never);

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (
          err as UnprocessableEntityException
        ).getResponse() as Record<string, unknown>;
        expect(body.code).toBe("DISALLOWED_OPERATION");
        expect(body.details).toBeUndefined();
      }
    });
  });

  describe("disallowed function name", () => {
    it("invoke on allowlisted contract with unknown fn throws UnprocessableEntityException", () => {
      const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, "admin_transfer");
      expect(() => validator.parseAndValidate(xdr)).toThrow(
        UnprocessableEntityException
      );
    });

    it("in NODE_ENV=production, fn rejection body is generic PREPARE_REJECTED", () => {
      process.env.NODE_ENV = "production";
      const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, "admin_transfer");

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (
          err as UnprocessableEntityException
        ).getResponse() as Record<string, unknown>;
        expect(body.code).toBe("PREPARE_REJECTED");
        expect(body.details).toBeUndefined();
      }
    });

    it("in NODE_ENV=development, fn rejection body includes fnName and contractId", () => {
      process.env.NODE_ENV = "development";
      const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, "admin_transfer");

      try {
        validator.parseAndValidate(xdr);
        fail("expected to throw");
      } catch (err) {
        const body = (err as UnprocessableEntityException).getResponse() as {
          code: string;
          details?: { fnName?: string; contractId?: string };
        };
        expect(body.code).toBe("DISALLOWED_OPERATION");
        expect(body.details?.fnName).toBe("admin_transfer");
        expect(body.details?.contractId).toBe(ALLOWED_BLEND_POOL);
      }
    });
  });

  describe("malformed XDR", () => {
    it("garbage string input throws BadRequestException with code INVALID_XDR", () => {
      try {
        validator.parseAndValidate("definitely-not-base64-xdr-garbage");
        fail("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: "INVALID_XDR",
        });
      }
    });

    it("empty string input throws INVALID_XDR", () => {
      expect(() => validator.parseAndValidate("")).toThrow(BadRequestException);
    });

    it("valid base64 but not a Stellar tx envelope throws INVALID_XDR", () => {
      const fakeBase64 = Buffer.from("not a stellar tx").toString("base64");
      expect(() => validator.parseAndValidate(fakeBase64)).toThrow(
        BadRequestException
      );
    });
  });

  describe("multi-op tx: any disallowed op fails the whole tx", () => {
    it("[allowed invoke, ManageData] throws DISALLOWED_OPERATION", () => {
      const account = makeAccount();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(invokeOp(ALLOWED_BLEND_POOL, "deposit"))
        .addOperation(Operation.manageData({ name: "test", value: "value" }))
        .setTimeout(30)
        .build();

      expect(() => validator.parseAndValidate(tx.toXDR())).toThrow(
        UnprocessableEntityException
      );
    });

    it("[allowed invoke, disallowed-contract invoke] throws DISALLOWED_CONTRACT in dev", () => {
      process.env.NODE_ENV = "development";
      const account = makeAccount();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(invokeOp(ALLOWED_BLEND_POOL, "deposit"))
        .addOperation(invokeOp(DISALLOWED_CONTRACT, "deposit"))
        .setTimeout(30)
        .build();

      try {
        validator.parseAndValidate(tx.toXDR());
        fail("expected to throw");
      } catch (err) {
        const body = (err as UnprocessableEntityException).getResponse() as {
          code: string;
        };
        expect(body.code).toBe("DISALLOWED_CONTRACT");
      }
    });

    it("multiple allowed invokes pass and return ops array preserving order", () => {
      const account = makeAccount();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(invokeOp(ALLOWED_BLEND_POOL, "deposit"))
        .addOperation(invokeOp(ALLOWED_VAULT_EURC, "withdraw"))
        .setTimeout(30)
        .build();

      const result = validator.parseAndValidate(tx.toXDR());

      expect(result.ops).toHaveLength(2);
      expect(result.ops[0]).toMatchObject({
        kind: "invoke",
        contractId: ALLOWED_BLEND_POOL,
        fnName: "deposit",
      });
      expect(result.ops[1]).toMatchObject({
        kind: "invoke",
        contractId: ALLOWED_VAULT_EURC,
        fnName: "withdraw",
      });
    });
  });

  describe("hash + sourceAccount extraction", () => {
    it("hash is 64-char lowercase hex (32 bytes)", () => {
      const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, "deposit");
      const result = validator.parseAndValidate(xdr);
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("sourceAccount matches the source set on the builder", () => {
      const account = makeAccount();
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: PASSPHRASE,
      })
        .addOperation(invokeOp(ALLOWED_BLEND_POOL, "deposit"))
        .setTimeout(30)
        .build();

      const result = validator.parseAndValidate(tx.toXDR());

      expect(result.sourceAccount).toBe(account.accountId());
    });

    it("passphrase equals StellarRpcService.getNetworkPassphrase()", () => {
      const { xdr } = buildInvokeXdr(ALLOWED_BLEND_POOL, "deposit");
      const result = validator.parseAndValidate(xdr);
      expect(result.passphrase).toBe(PASSPHRASE);
    });
  });
});
