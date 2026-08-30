import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";

@Injectable()
export class MailingUnsubscribeTokenService {
  private readonly secret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.get<string>("MAILING_UNSUBSCRIBE_SECRET");
  }

  get isConfigured(): boolean {
    return typeof this.secret === "string" && this.secret.length > 0;
  }

  sign(walletAddress: string): string {
    if (!this.isConfigured) {
      throw new Error("MAILING_UNSUBSCRIBE_SECRET not configured");
    }
    const sig = createHmac("sha256", this.secret!)
      .update(walletAddress)
      .digest("hex");
    return `${Buffer.from(walletAddress, "utf8").toString("base64url")}.${sig}`;
  }

  verify(token: string): string | null {
    if (!this.isConfigured) return null;
    try {
      const dot = token.lastIndexOf(".");
      if (dot <= 0 || dot === token.length - 1) return null;

      const walletB64 = token.slice(0, dot);
      const providedSig = token.slice(dot + 1);
      const walletAddress = Buffer.from(walletB64, "base64url").toString(
        "utf8"
      );
      if (!walletAddress) return null;

      const expectedSig = createHmac("sha256", this.secret!)
        .update(walletAddress)
        .digest("hex");

      if (providedSig.length !== expectedSig.length) return null;

      const a = Buffer.from(providedSig, "utf8");
      const b = Buffer.from(expectedSig, "utf8");
      if (a.length !== b.length) return null;
      if (!timingSafeEqual(a, b)) return null;

      return walletAddress;
    } catch {
      return null;
    }
  }
}
