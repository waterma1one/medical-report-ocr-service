import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "medical-report-ocr listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close((err) => {
    if (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
