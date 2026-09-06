import { Telegraf, Context, Markup } from "telegraf";
import { isSuperadmin } from "../middleware/auth";
import { editOrSend } from "../helpers/editOrSend";
import * as targets from "../../services/notifyTargetService";
import { renderWeekCard, renderDayCard, renderSubjectCard, renderDeadlineTimeline } from "../../services/scheduleImageService";
import { buildDigest, lessonsFor } from "../../services/dailyDigestService";
import { syncLinks, syncSchedule } from "../../services/icsService";
import Settings from "../../models/Settings";
import { sendCard } from "../../services/cardService";
import { buildDeadlineDigest } from "../../services/deadlineDigestService";


/** Картка з кнопкою назад у тому самому вікні: малюнок бере editOrSend. */
async function showCard(
  ctx: Context,
  caption: string,
  back: string,
  render: () => Promise<Buffer>
): Promise<void> {
  await editOrSend(
    ctx,
    caption,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", back)]]) as any,
    { render }
  );
}

const KINDS: { key: targets.NotifyKind; label: string }[] = [
  { key: "daily", label: "Ранковий дайджест 8:30" },
  { key: "lessons", label: "За 15 хв до пари" },
  { key: "deadlines", label: "Дедлайни" },
  { key: "weekly", label: "Підсумок тижня" },
];

function mark(on: boolean): string {
  return on ? "✅" : "▫️";
}

async function listTargets(ctx: Context): Promise<void> {
  const all = await targets.all();
  if (!all.length) {
    await editOrSend(
      ctx,
      "📣 <b>Розсилки</b>\n\nЖодного чату ще не підключено. Напишіть у групі /here — і вона зʼявиться тут.",
      Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", "settings")]]) as any
    );
    return;
  }
  const rows = all.map((t) => [
    Markup.button.callback(`${mark(t.enabled)} ${t.title || t.chatId}`, `nt_${t.chatId}`),
  ]);
  rows.push([Markup.button.callback("⬅️ Назад", "settings")]);
  await editOrSend(ctx, "📣 <b>Розсилки</b>\n\nОберіть чат:", Markup.inlineKeyboard(rows) as any);
}

async function chatCard(ctx: Context, chatId: string): Promise<void> {
  const all = await targets.all();
  const t = all.find((x) => x.chatId === chatId);
  if (!t) return listTargets(ctx);

  const rows = KINDS.map((k) => [
    Markup.button.callback(`${mark((t as any)[k.key])} ${k.label}`, `ntk_${chatId}_${k.key}`),
  ]);
  rows.push([Markup.button.callback(`${mark(t.enabled)} Чат увімкнено`, `ntk_${chatId}_enabled`)]);
  rows.push([Markup.button.callback("⬅️ До списку", "notify")]);

  await editOrSend(
    ctx,
    `📣 <b>${t.title || t.chatId}</b>\n<code>${t.chatId}</code>\n\nЩо надсилати в цей чат:`,
    Markup.inlineKeyboard(rows) as any
  );
}

export default function notifyHandler(bot: Telegraf): void {
  // Реєстрація чату: викликається прямо в групі
  bot.command("here", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      return ctx.reply("Команда працює лише в групі.");
    }
    if (!(await isSuperadmin(ctx))) {
      // Мовчазна відмова виглядає як зламаний бот, тому відповідаємо явно
      return ctx.reply("Підключати чати може лише суперадмін.");
    }
    const chat = ctx.chat;
    const title = "title" in chat ? chat.title : "";
    await targets.upsert(String(ctx.chat.id), title);
    await ctx.reply(`✅ Чат «${title}» підключено. Що саме надсилати — у налаштуваннях бота.`);
  });

  bot.action("notify", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await isSuperadmin(ctx))) return;
    await listTargets(ctx);
  });

  bot.action(/^nt_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await isSuperadmin(ctx))) return;
    await chatCard(ctx, (ctx.match as RegExpMatchArray)[1]);
  });

  bot.action(/^ntk_(-?\d+)_(\w+)$/, async (ctx) => {
    const m = ctx.match as RegExpMatchArray;
    if (!(await isSuperadmin(ctx))) return;
    await targets.toggle(m[1], m[2] as targets.NotifyKind);
    await ctx.answerCbQuery("Змінено");
    await chatCard(ctx, m[1]);
  });

  // Картинки розкладу
  bot.action("sch_img_week", async (ctx) => {
    await ctx.answerCbQuery("Малюю…");
    await showCard(ctx, "📅 <b>Розклад на тиждень</b>", "sch", () => renderWeekCard(new Date()));
  });

  bot.action("sch_img_day", async (ctx) => {
    await ctx.answerCbQuery("Малюю…");
    const now = new Date();
    const { text } = await buildDigest(now);
    await showCard(ctx, text, "sch", async () => renderDayCard(now, await lessonsFor(now)));
  });

  bot.command("today", async (ctx) => {
    const now = new Date();
    const { text } = await buildDigest(now);
    await sendCard(ctx.telegram, ctx.chat!.id, { render: async () => renderDayCard(now, await lessonsFor(now)) }, { caption: text }).catch(
      () => ctx.reply(text, { parse_mode: "HTML" })
    );
  });

  // /ics <посилання> - зберегти календар; /ics без аргументів - пересинхронити
  bot.command("ics", async (ctx) => {
    if (!(await isSuperadmin(ctx))) return;
    const arg = (ctx.message as any)?.text?.split(/\s+/)[1];
    const settings = await Settings.findOneAndUpdate(
      { key: "main" },
      arg ? { icsUrl: arg } : {},
      { upsert: true, returnDocument: "after" }
    );
    const url = settings?.icsUrl;
    if (!url) {
      return ctx.reply("Надішли: /ics <посилання на .ics з Outlook>");
    }
    if (arg && ctx.chat && ctx.chat.type !== "private") {
      await ctx.deleteMessage().catch(() => {});
    }
    const msg = await ctx.reply("Тягну календар…");
    try {
      const sch = await syncSchedule(url);
      const { matched } = await syncLinks(url);
      const tail = sch.unmatched.length
        ? `\n\nНе зіставив:\n${sch.unmatched.slice(0, 6).map((x) => `• ${x}`).join("\n")}`
        : "";
      await ctx.telegram.editMessageText(
        msg.chat.id, msg.message_id, undefined,
        `✅ Календар прочитано.\nПар у розкладі: ${sch.slots}\nПредметів із посиланням: ${matched}${tail}`
      );
    } catch (e) {
      await ctx.telegram.editMessageText(
        msg.chat.id, msg.message_id, undefined,
        `❌ Не вийшло: ${e instanceof Error ? e.message : e}`
      );
    }
  });

  bot.action("deadlines_img", async (ctx) => {
    await ctx.answerCbQuery("Малюю…");
    await showCard(ctx, "⏳ <b>Дедлайни</b>\nНайближчі три тижні", "main_menu", () =>
      renderDeadlineTimeline(new Date(), 21)
    );
  });

  bot.command("deadlines", async (ctx) => {
    const now = new Date();
    const text = (await buildDeadlineDigest(now)) || "⏳ <b>Дедлайни</b>\nНічого не горить.";
    await sendCard(ctx.telegram, ctx.chat!.id, { render: () => renderDeadlineTimeline(now, 14) }, { caption: text });
  });

  bot.action(/^subjimg_(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery("Малюю…");
    const id = (ctx.match as RegExpMatchArray)[1];
    await showCard(ctx, "📊 <b>Картка предмета</b>", `subject_${id}`, () => renderSubjectCard(id));
  });

  bot.command("week", async (ctx) => {
    await sendCard(ctx.telegram, ctx.chat!.id, { render: () => renderWeekCard(new Date()) });
  });
}
