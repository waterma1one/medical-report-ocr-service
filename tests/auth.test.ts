import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { requireAuth } from "../src/middleware/auth.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

function buildProtectedApp() {
  const app = express();
  app.get("/protected", requireAuth, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(buildProtectedApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("rejects a non-Bearer scheme", async () => {
    const res = await request(buildProtectedApp())
      .get("/protected")
      .set("Authorization", "Basic dGVzdC10b2tlbg==");
    expect(res.status).toBe(401);
  });

  it("rejects a Bearer token that doesn't match", async () => {
    const res = await request(buildProtectedApp())
      .get("/protected")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("rejects an empty Bearer token", async () => {
    const res = await request(buildProtectedApp())
      .get("/protected")
      .set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });

  it("accepts the correct Bearer token, case-insensitive scheme", async () => {
    const res = await request(buildProtectedApp())
      .get("/protected")
      .set("Authorization", "bearer test-token");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
