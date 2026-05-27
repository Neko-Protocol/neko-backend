import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Number of trusted proxy hops in front of this server. MUST match the real
  // deployment topology:
  //   0 = no proxy (default; safe for dev local and direct exposure)
  //   1 = one proxy in front (Vercel / Cloudflare edge / Railway / Fly)
  //   N = N proxies chained
  //
  // When > 0, Express reads X-Forwarded-For so @Ip() and the throttler's
  // default tracker resolve to the real client IP. Without this in prod, every
  // request appears to come from the proxy IP and the per-IP rate limits in
  // app.module.ts collapse into a single global bucket — one user can lock out
  // everyone else, or an attacker can DoS the relay by holding the cap.
  //
  // Setting it higher than the real chain lets attackers inject fake hops at
  // the start of X-Forwarded-For and spoof their client IP, so the env var
  // MUST be configured per deployment, not left to a default that assumes
  // hosting topology we don't know yet.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
    Logger.log(
      `Trusting ${trustProxyHops} proxy hop(s) for X-Forwarded-For`,
      "Bootstrap"
    );
  }

  const corsOriginRaw = process.env.CORS_ORIGIN ?? "";
  const origins = corsOriginRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    Logger.warn(
      "CORS_ORIGIN is empty — all browser origins will be rejected. Set the env var before exposing the service.",
      "Bootstrap"
    );
  }

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    methods: ["GET", "POST"],
    credentials: false,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Neko backend listening on :${port}`, "Bootstrap");
}

bootstrap();
