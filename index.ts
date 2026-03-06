import "dotenv/config";
import { Telegraf } from "telegraf";
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import connectDB from "./src/config/database";
import { setupBot } from "./src/bot";
import apiRoutes from "./src/api";

const BOT_TOKEN = process.env.BOT_TOKEN;
const MODE = process.env.MODE || "polling";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

async function main(): Promise<void> {
  await connectDB();

  // Run migrations
  const { migrateRoles, migrateModelsToModelConfig } = await import("./src/services/userService");
  await migrateRoles().catch((e: Error) => console.error("[migrate] roles:", e.message));
  await migrateModelsToModelConfig().catch((e: Error) => console.error("[migrate] models:", e.message));

  // Sync model catalog on startup
  const { syncAll } = await import("./src/services/modelCatalogService");
  syncAll().catch((e: Error) => console.error("[modelCatalog] sync error:", e.message));

  // Start usage tracking (if USAGE_DATABASE_URI is set)
  const { startTracking, stopTracking } = await import("./src/lib/tracked-ai");
  startTracking();

  const bot = new Telegraf(BOT_TOKEN!);
  const { setBot } = await import("./src/lib/bot");
  setBot(bot);
  setupBot(bot);

  // Start schedule notifications
  const { startScheduleNotifier } = await import("./src/services/scheduleNotificationService");
  startScheduleNotifier(bot);

  // Start deadline notifications
  const { startDeadlineNotifier } = await import("./src/services/deadlineNotificationService");
  startDeadlineNotifier(bot);

  // Start weekly digest
  const { startWeeklyDigest } = await import("./src/services/weeklyDigestService");
  startWeeklyDigest(bot);

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
  app.get("/{*splat}", (req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (MODE !== "webhook") {
    bot.launch().catch((err: Error) => {
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
  process.on("unhandledRejection", (err: unknown) => {
    console.error("[unhandledRejection]", (err as Error)?.message || err);
  });
}

main().catch(console.error);
