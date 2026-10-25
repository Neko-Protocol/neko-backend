import WebSocket from "ws";
import {
  BadRequestException,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { ErrorCode } from "@neko-protocol/api-contracts";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { AppModule } from "./app.module";
import { parseCorsOrigins } from "./config/cors-origins";

// Node.js < 22 has no global WebSocket; @supabase/supabase-js's realtime client
// requires one at construction time. Polyfill it before any client is created.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    WebSocket;
}

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
    bufferLogs: true,
    // Raw bytes are needed to verify Didit webhook signatures.
    rawBody: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // See TRUST_PROXY_HOPS in .env.example — setting higher than the real chain
  // lets clients spoof X-Forwarded-For.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isFinite(trustProxyHops) && trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }

  const origins = parseCorsOrigins(process.env.CORS_ORIGIN);

  if (origins.length === 0) {
    logger.warn(
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
      // Nest's default exceptionFactory throws a BadRequestException whose
      // getResponse().message is a string[], which AllExceptionsFilter can't
      // read (it only reads a string `message`) — field-level errors were
      // silently dropped. Synthesize a {code, message, details} body instead
      // so validation failures survive the filter with a stable code the
      // frontend can translate.
      exceptionFactory: (errors) => {
        const details = errors.map((e) => ({
          field: e.property,
          constraints: e.constraints ? Object.values(e.constraints) : [],
        }));
        return new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: "Validation failed",
          details,
        });
      },
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  const swagger = new DocumentBuilder()
    .setTitle("Neko Backend")
    .setDescription("Neko DApp.")
    .setVersion("1.0")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swagger), {
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(`Neko backend listening on :${port}`, "Bootstrap");
}

bootstrap();
