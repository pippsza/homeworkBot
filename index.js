require("dotenv").config();
const { Telegraf } = require("telegraf");
const express = require("express");
const subjectsHandler = require("./handlers/subjects");

const BOT_TOKEN = process.env.BOT_TOKEN;
const MODE = process.env.MODE || "polling";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env");
}

const bot = new Telegraf(BOT_TOKEN);
subjectsHandler(bot);

if (MODE === "webhook") {
  const app = express();
  app.use(express.json());
  app.use(bot.webhookCallback("/bot"));
  bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`);
  app.get("/", (req, res) => res.send("Bot is running (webhook mode)"));
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
} else {
  bot.launch();
  console.log("Bot started in polling mode");
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
