import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { healthRouter } from "./routes/health.js";
import { extractRouter } from "./routes/extract.js";
import { errorHandler } from "./middleware/errorHandler.js";

// A client-supplied correlation id is echoed back in a response header, so it has to
// be constrained: a value containing CR/LF would let a caller inject headers, and an
// unbounded one is just a wasted allocation.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => {
        const supplied = req.headers["x-request-id"];
        return typeof supplied === "string" && SAFE_REQUEST_ID.test(supplied)
          ? supplied
          : randomUUID();
      },
      // OCR document content never reaches these serializers, but keep the request/
      // response logs to metadata only as a matter of habit for this domain.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use((req, res, next) => {
    res.set("X-Request-Id", String(req.id));
    next();
  });

  // Unauthenticated and mounted before any auth middleware: the Docker HEALTHCHECK
  // hits this directly, and it must not depend on a bearer token.
  app.use(healthRouter);

  app.use(extractRouter);

  // Unmatched routes get the same error envelope as everything else rather than
  // Express's default HTML page.
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "No such endpoint" },
    });
  });

  // Must be last: Express identifies error middleware by its four-argument
  // signature and only reaches it after every other handler has had a turn.
  app.use(errorHandler);

  return app;
}
