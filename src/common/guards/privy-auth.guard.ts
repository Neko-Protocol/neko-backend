import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { PrivyService } from "@core/privy/privy.service";
import type { PrivyPrincipal } from "@core/privy/privy.types";

export type PrivyRequest = {
  headers: Record<string, string | string[] | undefined>;
  privy?: PrivyPrincipal;
};

/**
 * Authenticates end users with a Privy access token. Routes using it are
 * reachable from the mobile app directly, so they pair it with @SkipAuth()
 * to bypass the internal-key guard, which only proves the call came through
 * our web proxy.
 */
@Injectable()
export class PrivyAuthGuard implements CanActivate {
  constructor(private readonly privy: PrivyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PrivyRequest>();
    const raw = req.headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;
    if (!token) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
    req.privy = await this.privy.verifyAccessToken(token);
    return true;
  }
}
