import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ErrorCode } from "@neko/api-contracts";
import { AdminAuthService } from "./admin-auth.service";

/**
 * Protects admin-only routes: requires a Supabase access token (from the
 * admin-auth OTP sign-in flow) belonging to an active row in admin_emails.
 * The shared InternalApiKeyGuard only proves the request came through our
 * own proxy, it does not prove the caller is an admin.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();

    const raw = req.headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

    if (!token || !(await this.adminAuth.verifyAdminToken(token))) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
    return true;
  }
}
