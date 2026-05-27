import { HttpStatus } from "@nestjs/common";
import { SorobanContractException } from "../../../shared/stellar/soroban-contract.exception";
import { SorobanErrorMapper } from "./soroban-error.mapper";

const TRACE_ID = "trace-abc-123";

describe("SorobanErrorMapper", () => {
  let mapper: SorobanErrorMapper;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    mapper = new SorobanErrorMapper();
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  describe("mapSendError → HttpException", () => {
    it("returns a SorobanContractException", () => {
      const ex = mapper.mapSendError(new Error("anything"), TRACE_ID);
      expect(ex).toBeInstanceOf(SorobanContractException);
    });

    it("includes the traceId in the response body", () => {
      const ex = mapper.mapSendError(new Error("anything"), TRACE_ID);
      const body = ex.getResponse() as Record<string, unknown>;
      expect(body.traceId).toBe(TRACE_ID);
    });

    it("uses HTTP 422 for all mapped codes", () => {
      const samples = [
        new Error("tx_bad_seq"),
        new Error("source account not found"),
        new Error("insufficient fee for the transaction"),
        new Error("insufficient balance"),
        new Error("authorization failed"),
        new Error("HostObjectNotExist"),
        new Error("HostError: ... Contract, Error(7)"),
        new Error("random unmapped soroban error"),
      ];
      for (const raw of samples) {
        const ex = mapper.mapSendError(raw, TRACE_ID);
        expect(ex.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      }
    });
  });

  describe("decoded code propagation", () => {
    it("maps tx_bad_seq → BAD_SEQUENCE", () => {
      const ex = mapper.mapSendError(new Error("tx_bad_seq"), TRACE_ID);
      expect((ex.getResponse() as { code: string }).code).toBe("BAD_SEQUENCE");
    });

    it("maps account-not-found errors → SOURCE_ACCOUNT_NOT_FOUND", () => {
      const ex = mapper.mapSendError(
        new Error("source account not found"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe(
        "SOURCE_ACCOUNT_NOT_FOUND"
      );
    });

    it("maps insufficient fee → INSUFFICIENT_FEE", () => {
      const ex = mapper.mapSendError(
        new Error("insufficient fee charged"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe(
        "INSUFFICIENT_FEE"
      );
    });

    it("maps insufficient balance → INSUFFICIENT_BALANCE", () => {
      const ex = mapper.mapSendError(
        new Error("insufficient balance for op"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe(
        "INSUFFICIENT_BALANCE"
      );
    });

    it("maps authorization failures → AUTH_FAILED", () => {
      const ex = mapper.mapSendError(
        new Error("authorization missing"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe("AUTH_FAILED");
    });

    it("maps HostObjectNotExist → HOST_OBJECT_MISSING", () => {
      const ex = mapper.mapSendError(
        new Error("HostObjectNotExist for id 7"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe(
        "HOST_OBJECT_MISSING"
      );
    });

    it("maps Soroban Contract(N) errors → SOROBAN_CONTRACT_ERROR with rawCode in dev", () => {
      process.env.NODE_ENV = "development";
      const ex = mapper.mapSendError(
        new Error("HostError: ... Contract, Error(42)"),
        TRACE_ID
      );
      const body = ex.getResponse() as {
        code: string;
        details?: { rawCode?: number };
      };
      expect(body.code).toBe("SOROBAN_CONTRACT_ERROR");
      expect(body.details?.rawCode).toBe(42);
    });

    it("unknown / unmatched error message → SOROBAN_UNKNOWN_ERROR", () => {
      const ex = mapper.mapSendError(
        new Error("just some unrelated string"),
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe(
        "SOROBAN_UNKNOWN_ERROR"
      );
    });
  });

  describe("prod vs dev body shape", () => {
    it("in NODE_ENV=production, Soroban contract details are omitted", () => {
      process.env.NODE_ENV = "production";
      const ex = mapper.mapSendError(
        new Error("HostError: ... Contract, Error(13)"),
        TRACE_ID
      );
      const body = ex.getResponse() as Record<string, unknown>;
      expect(body.details).toBeUndefined();
      expect(body.code).toBe("SOROBAN_CONTRACT_ERROR");
      expect(body.traceId).toBe(TRACE_ID);
    });

    it("in NODE_ENV=development, Soroban contract details include rawCode", () => {
      process.env.NODE_ENV = "development";
      const ex = mapper.mapSendError(
        new Error("HostError: ... Contract, Error(13)"),
        TRACE_ID
      );
      const body = ex.getResponse() as {
        details?: { rawCode?: number };
      };
      expect(body.details?.rawCode).toBe(13);
    });

    it("internalDetails are retained on the exception instance even in prod", () => {
      process.env.NODE_ENV = "production";
      const ex = mapper.mapSendError(
        new Error("HostError: ... Contract, Error(99)"),
        TRACE_ID
      );
      expect(ex.internalDetails?.rawCode).toBe(99);
    });
  });

  describe("mapPollError", () => {
    it("delegates to the same decoding logic as mapSendError", () => {
      const ex = mapper.mapPollError(new Error("tx_bad_seq"), TRACE_ID);
      expect((ex.getResponse() as { code: string }).code).toBe("BAD_SEQUENCE");
      expect(ex.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });
  });

  describe("input shapes other than Error", () => {
    it("accepts a plain string error", () => {
      const ex = mapper.mapSendError("tx_bad_seq", TRACE_ID);
      expect((ex.getResponse() as { code: string }).code).toBe("BAD_SEQUENCE");
    });

    it("accepts a structured rpc response with status/message", () => {
      const ex = mapper.mapSendError(
        { status: "ERROR", message: "authorization failure" },
        TRACE_ID
      );
      expect((ex.getResponse() as { code: string }).code).toBe("AUTH_FAILED");
    });

    it("handles null without throwing", () => {
      const ex = mapper.mapSendError(null, TRACE_ID);
      expect((ex.getResponse() as { code: string }).code).toBe(
        "SOROBAN_UNKNOWN_ERROR"
      );
    });
  });
});
