import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { AdminAuthService } from "./admin-auth.service";

export interface AdminRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Set by AdminAuthGuard once the token checks out. */
  adminEmail?: string;
}

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
    const req = ctx.switchToHttp().getRequest<AdminRequest>();

    const raw = req.headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

    const email = token ? await this.adminAuth.verifyAdminToken(token) : null;
    if (!email) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED });
    }
    req.adminEmail = email;
    return true;
  }
}
