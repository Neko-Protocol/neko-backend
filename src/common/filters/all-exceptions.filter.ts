import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { ErrorCode, type ApiErrorBody } from "@neko-protocol/api-contracts";

const isProd = () => process.env.NODE_ENV === "production";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = req.traceId ?? randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const original = exception.getResponse();
      const body = this.toErrorBody(original, exception.message, traceId);

      this.logger.warn({
        event: "http_exception",
        traceId,
        status,
        path: req.url,
        method: req.method,
        code: body.code,
      });
      res.status(status).json(body);
      return;
    }

    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error({
      event: "unhandled_exception",
      traceId,
      path: req.url,
      method: req.method,
      message,
      stack,
    });

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: isProd() ? "Internal server error" : message,
      traceId,
    });
  }

  private toErrorBody(
    original: string | object,
    fallbackMessage: string,
    traceId: string
  ): ApiErrorBody {
    if (typeof original === "string") {
      return { code: ErrorCode.ERROR, message: original, traceId };
    }
    const obj = original as Record<string, unknown>;
    return {
      code: typeof obj.code === "string" ? obj.code : ErrorCode.ERROR,
      message: typeof obj.message === "string" ? obj.message : fallbackMessage,
      traceId: typeof obj.traceId === "string" ? obj.traceId : traceId,
      ...(obj.publicDetails !== undefined
        ? { details: obj.publicDetails }
        : {}),
      ...(obj.details !== undefined && !isProd()
        ? { details: obj.details }
        : {}),
    };
  }
}
