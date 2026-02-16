const crypto = require("crypto");

function validateTelegramWebAppData(initData, botToken) {
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

function telegramAuthMiddleware(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];
  if (!initData) {
    console.log("[auth] FAIL: no initData header, path:", req.method, req.path);
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!validateTelegramWebAppData(initData, process.env.BOT_TOKEN)) {
    console.log("[auth] FAIL: invalid initData, path:", req.method, req.path);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const params = new URLSearchParams(initData);
  const userStr = params.get("user");
  if (userStr) {
    req.telegramUser = JSON.parse(userStr);
  }
  next();
}

module.exports = telegramAuthMiddleware;
