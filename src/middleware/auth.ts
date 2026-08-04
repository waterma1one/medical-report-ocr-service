import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { UnauthorizedError } from "../errors.js";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so guard first. The length check
  // itself leaks a little, but nothing more than an attacker gets from a normal
  // HTTP response anyway, and it's the standard shape for this comparison.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  res.set("WWW-Authenticate", "Bearer");

  const header = req.get("authorization");
  if (!header) {
    next(new UnauthorizedError());
    return;
  }

  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    next(new UnauthorizedError());
    return;
  }

  if (!safeEqual(token, config.bearerToken)) {
    next(new UnauthorizedError());
    return;
  }

  next();
}
