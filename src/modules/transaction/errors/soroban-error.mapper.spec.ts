// SCAFFOLD — feat/lending-tests
//
// Unit tests for SorobanErrorMapper in PR2 v2 (transaction relay backend).
// Production file:
//   apps/backend/src/modules/transaction/errors/soroban-error.mapper.ts
//
// Decisions validated (tx-relay-backend-plan §2):
//   D7  — Generic mapper, protocol-agnostic (no Blend/Aqua specifics here)
//   D18 — Prod body omits rawScvalDetails; dev body includes it
//
// Activation (when feat/lending-backend lands SorobanErrorMapper):
//   1. Replace `it.todo("...")` with real `it("...", () => { ... })`.
//   2. Add imports:
//        import { SorobanErrorMapper } from "./soroban-error.mapper";
//        import {
//          BadRequestException,
//          ForbiddenException,
//          HttpException,
//          UnprocessableEntityException,
//        } from "@nestjs/common";
//   3. Construct synthetic RPC sendTransaction error payloads + decoded
//      scval bodies. Run each through mapper.mapSendError(raw, traceId)
//      and assert (a) HttpException subclass, (b) status code, (c) body code.
//   4. Toggle NODE_ENV between "production" and "development" to validate
//      that rawScvalDetails is stripped in prod (D18).

describe("SorobanErrorMapper", () => {
  describe("mapped Soroban error codes → HttpException matrix (D7)", () => {
    // The exact code list comes from soroban-error.decoder.ts in
    // apps/backend/src/shared/stellar/. The decoder extracts a generic
    // { code, scvalDetails } from the RPC error envelope and the mapper
    // maps each known code to an HttpException subclass.

    it.todo(
      "InvalidAction → ForbiddenException 403 with body code 'INVALID_ACTION'"
    );

    it.todo(
      "InvalidArgument → BadRequestException 400 with body code 'INVALID_ARGUMENT'"
    );

    it.todo(
      "InsufficientBalance → UnprocessableEntityException 422 with body code 'INSUFFICIENT_BALANCE'"
    );

    it.todo(
      "RateExceeded → UnprocessableEntityException 422 with body code 'RATE_EXCEEDED'"
    );

    it.todo(
      "InternalContractError → UnprocessableEntityException 422 with body code 'INTERNAL_CONTRACT_ERROR'"
    );

    it.todo(
      "BudgetExceeded → UnprocessableEntityException 422 with body code 'BUDGET_EXCEEDED'"
    );

    it.todo(
      "InvalidInput → BadRequestException 400 with body code 'INVALID_INPUT'"
    );
  });

  describe("unmapped contract error (D7)", () => {
    it.todo(
      "unknown Soroban error code → UnprocessableEntityException 422 with generic 'SOROBAN_CONTRACT_ERROR'"
    );

    it.todo(
      "raw RPC payload missing a code field → falls through to SOROBAN_CONTRACT_ERROR"
    );
  });

  describe("prod vs dev body shape (D18)", () => {
    it.todo(
      "in NODE_ENV=production, mapped exception body excludes rawScvalDetails"
    );

    it.todo(
      "in NODE_ENV=production, unmapped exception body excludes rawScvalDetails and rawCode"
    );

    it.todo(
      "in NODE_ENV=development, mapped exception body includes rawScvalDetails with full diagnostic info"
    );

    it.todo(
      "in NODE_ENV=development, unmapped exception body includes rawCode for debugging"
    );
  });

  describe("traceId propagation", () => {
    it.todo(
      "every mapped HttpException body includes the traceId passed by the caller"
    );

    it.todo(
      "traceId is preserved in the unmapped SOROBAN_CONTRACT_ERROR body"
    );
  });
});
