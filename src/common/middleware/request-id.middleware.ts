import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    traceId: string;
  }
}

const HEADER = "x-request-id";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header(HEADER);
    const traceId =
      incoming && incoming.length <= 128 ? incoming : randomUUID();
    req.traceId = traceId;
    res.setHeader("X-Request-Id", traceId);
    next();
  }
}
