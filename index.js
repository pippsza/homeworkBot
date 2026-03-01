require("dotenv").config();
const { Telegraf } = require("telegraf");
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./src/config/database");
const setupBot = require("./src/bot");
const apiRoutes = require("./src/api");

const BOT_TOKEN = process.env.BOT_TOKEN;
const MODE = process.env.MODE || "polling";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

async function main() {
  await connectDB();

  // Run migrations
  const { migrateRoles, migrateModelsToModelConfig } = require("./src/services/userService");
  await migrateRoles().catch((e) => console.error("[migrate] roles:", e.message));
  await migrateModelsToModelConfig().catch((e) => console.error("[migrate] models:", e.message));

  // Sync model catalog on startup
  const { syncAll } = require("./src/services/modelCatalogService");
  syncAll().catch((e) => console.error("[modelCatalog] sync error:", e.message));

  // Start usage tracking (if USAGE_DATABASE_URI is set)
  const { startTracking, stopTracking } = require("./src/lib/tracked-ai");
  startTracking();

  const bot = new Telegraf(BOT_TOKEN);
  setupBot(bot);

  // Start schedule notifications
  const { startScheduleNotifier } = require("./src/services/scheduleNotificationService");
  startScheduleNotifier(bot);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // API routes for Mini App
  app.use("/api", apiRoutes);

  // Serve built React frontend
  const clientDist = path.join(__dirname, "client/dist");
  app.use(express.static(clientDist));

  if (MODE === "webhook") {
    app.use(bot.webhookCallback("/bot"));
    bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`);
  }

  // SPA fallback
  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (MODE !== "webhook") {
    bot.launch().catch((err) => {
      console.error("Bot polling failed:", err.message);
      console.log("Server continues running without bot polling (API still works)");
    });
    console.log("Bot started in polling mode");
  }

  process.once("SIGINT", async () => {
    await stopTracking();
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", async () => {
    await stopTracking();
    bot.stop("SIGTERM");
  });

  // Prevent unhandled stream errors from crashing the server
  process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err?.message || err);
  });
}

main().catch(console.error);
