import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import type { PrivyPrincipal as Principal } from "@core/privy/privy.types";
import type { PrivyRequest } from "../guards/privy-auth.guard";

export const PrivyPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<PrivyRequest>().privy;
    if (!principal) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
    return principal;
  }
);
