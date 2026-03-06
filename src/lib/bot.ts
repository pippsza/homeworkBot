import { Telegraf } from "telegraf";

let _bot: Telegraf | null = null;

export function setBot(bot: Telegraf): void {
  _bot = bot;
}

export function getBot(): Telegraf | null {
  return _bot;
}
