import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import type { IncomingMessage } from "http";
import { InternalApiKeyGuard } from "./common/guards/internal-api-key.guard";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { envValidationSchema } from "./config/env.validation";
import { CoreModule } from "./core/core.module";
import { ChainModule } from "./domains/chain/chain.module";
import { MarketDataModule } from "./domains/market-data/market-data.module";
import { InvestingModule } from "./domains/investing/investing.module";
import { PlatformModule } from "./domains/platform/platform.module";
import { AdminModule } from "./domains/admin/admin.module";

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
    ScheduleModule.forRoot(),
    CoreModule,
    ChainModule,
    MarketDataModule,
    InvestingModule,
    PlatformModule,
    AdminModule,
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
