import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "crypto";
import { ErrorCode } from "@neko/api-contracts";
import { SKIP_AUTH_KEY } from "../decorators/skip-auth.decorator";

const HEADER_NAME = "x-internal-key";

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const raw = req.headers[HEADER_NAME];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    const expected = this.config.get<string>("INTERNAL_API_KEY");

    if (!expected || !presented || !safeEqual(presented, expected)) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
