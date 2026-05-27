import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import helmet from "helmet";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { AppModule } from "./app.module";

process.on("unhandledRejection", (reason, promise) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: "unhandled_rejection",
      reason:
        reason instanceof Error ? (reason.stack ?? reason.message) : reason,
      promise: String(promise),
      ts: new Date().toISOString(),
    })
  );
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      event: "uncaught_exception",
      message: err.message,
      stack: err.stack,
      ts: new Date().toISOString(),
    })
  );
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // See TRUST_PROXY_HOPS in .env.example — setting higher than the real chain
  // lets clients spoof X-Forwarded-For.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }

  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    Logger.warn(
      "CORS_ORIGIN is empty — every browser origin will be rejected.",
      "Bootstrap"
    );
  }

  // CSP off — JSON-only API.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(compression());

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
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`Neko backend listening on :${port}`, "Bootstrap");
}

bootstrap();
