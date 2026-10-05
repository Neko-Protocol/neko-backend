import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { PrivyService } from "@core/privy/privy.service";
import { PrivyAuthGuard, type PrivyRequest } from "./privy-auth.guard";

function ctx(req: PrivyRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("PrivyAuthGuard", () => {
  const principal = { userId: "did:privy:ana", sessionId: "s1" };
  const privy = {
    verifyAccessToken: jest.fn(async () => principal),
  } as unknown as PrivyService;
  const guard = new PrivyAuthGuard(privy);

  it("attaches the verified principal", async () => {
    const req: PrivyRequest = { headers: { authorization: "Bearer tok" } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.privy).toEqual(principal);
    expect(privy.verifyAccessToken).toHaveBeenCalledWith("tok");
  });

  it.each([{}, { authorization: "Basic abc" }, { authorization: "Bearer " }])(
    "rejects %p",
    async (headers) => {
      await expect(guard.canActivate(ctx({ headers }))).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    }
  );
});
