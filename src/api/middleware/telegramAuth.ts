import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  telegramUser?: { id: string; username?: string; first_name?: string };
}

function validateTelegramWebAppData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return hash === calculatedHash;
}

function telegramAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const initData = req.headers["x-telegram-init-data"] as string | undefined;
  if (!initData) {
    console.log("[auth] FAIL: no initData header, path:", req.method, req.path);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!validateTelegramWebAppData(initData, process.env.BOT_TOKEN!)) {
    console.log("[auth] FAIL: invalid initData, path:", req.method, req.path);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = new URLSearchParams(initData);
  const userStr = params.get("user");
  if (userStr) {
    req.telegramUser = JSON.parse(userStr);
  }
  next();
}

export default telegramAuthMiddleware;
