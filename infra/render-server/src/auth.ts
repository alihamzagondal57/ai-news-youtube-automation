import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

export function requireSharedSecret(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || token !== config.sharedSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
