import { Router } from "express";

export const healthRouter: Router = Router();

const startedAt = Date.now();

// Deliberately shallow: this does not call Datalab. A liveness check that depends on a
// third-party API spends credits on every probe and ties our uptime to theirs.
healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});
