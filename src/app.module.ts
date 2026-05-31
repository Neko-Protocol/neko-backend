import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import type { IncomingMessage } from "http";
import { InternalApiKeyGuard } from "./common/guards/internal-api-key.guard";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { envValidationSchema } from "./config/env.validation";
import { HealthModule } from "./modules/health/health.module";
import { OrchestratorModule } from "./modules/orchestrator/orchestrator.module";
import { SupabaseModule } from "./modules/supabase/supabase.module";
import { StellarModule } from "./modules/stellar/stellar.module";
import { TransactionModule } from "./modules/transaction/transaction.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true } },
        customProps: (req: IncomingMessage) => ({
          traceId: (req as IncomingMessage & { traceId?: string }).traceId,
        }),
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-supabase-auth']",
          ],
          censor: "[REDACTED]",
        },
        serializers: {
          req(req: { method?: string; url?: string }) {
            return { method: req.method, url: req.url };
          },
        },
      },
    }),
    // Per-endpoint overrides live on TransactionController.
    ThrottlerModule.forRoot([
      { name: "short", ttl: 1_000, limit: 20 },
      { name: "default", ttl: 60_000, limit: 60 },
    ]),
    StellarModule,
    SupabaseModule,
    OrchestratorModule,
    HealthModule,
    TransactionModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: InternalApiKeyGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
