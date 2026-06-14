import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";
import { AnchorError } from "./lib/types";

/**
 * Preserves the legacy anchor route response contract that the web-app
 * `rampApi` client depends on:
 *   - AnchorError      → { error, code } at its statusCode
 *   - HttpException    → { error } at its status (404 used to resolve to null)
 *   - anything else    → 500 { error, details }
 * This overrides the global AllExceptionsFilter for the anchor controller.
 */
@Catch()
export class AnchorExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AnchorError) {
      res
        .status(exception.statusCode)
        .json({ error: exception.message, code: exception.code });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: string | string[] }).message ??
            exception.message);
      res.status(status).json({
        error: Array.isArray(message) ? message.join(", ") : message,
      });
      return;
    }

    res.status(500).json({
      error: "Internal server error",
      details:
        exception instanceof Error ? exception.message : String(exception),
    });
  }
}
