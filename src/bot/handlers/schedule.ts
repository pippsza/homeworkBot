import { Telegraf, Context, Markup } from "telegraf";
import { editOrSend } from "../helpers/editOrSend";
import { isStudent } from "../middleware/auth";
import * as inputState from "../helpers/inputState";
import * as scheduleService from "../../services/scheduleService";
import { dayPlan, DayPlan } from "../../services/dailyDigestService";
import { renderDayCard } from "../../services/scheduleImageService";

interface ScheduleClass {
  slotNumber: number;
  startTime: string;
  endTime: string;
  subjectEmoji?: string;
  subjectName?: string;
}

interface ScheduleResult {
  isOdd: boolean;
  weekNumber: number;
  isSaturday?: boolean;
  followsDayName?: string;
  noMapping?: boolean;
  classes: ScheduleClass[];
}

/** Підпис під карткою: пари видно на картинці, тут лишаємо тільки шапку. */
function formatScheduleCaption(date: Date, plan: DayPlan): string {
  const dateStr = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  const lines = [
    "📅 <b>Расписание</b>",
    `📆 ${dateStr} · неделя ${plan.weekNumber} (${plan.odd ? "нечётная" : "чётная"})`,
  ];
  if (plan.followsDayName) lines.push(`🔄 Суббота по расписанию ${plan.followsDayName.toLowerCase()}`);
  if (!plan.lessons.length) lines.push(plan.noMapping ? "🎉 Суббота без пар на этой неделе" : "🎉 Нет занятий");
  return lines.join("\n");
}

function shortName(name?: string): string {
  if (!name) return "пара";
  return name.length > 18 ? name.slice(0, 17) + "…" : name;
}

function navKeyboard(offset: number, joins: any[] = [], canEdit = false) {
  const nav = [
    Markup.button.callback("◀️", `schd_${offset - 1}`),
    Markup.button.callback("Сегодня", "sch"),
    Markup.button.callback("▶️", `schd_${offset + 1}`),
  ];
  if (canEdit) nav.push(Markup.button.callback("🔗", `schlnk_${offset}`));
  return Markup.inlineKeyboard([...joins.map((b) => [b]), nav, [Markup.button.callback("🏠 Меню", "main_menu")]]);
}

export async function showSchedule(ctx: Context, offset: number = 0): Promise<void> {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const plan = await dayPlan(date);
  // Посилання зберігається в слоті: у лекції і лабораторної воно різне,
  // тому на рівні предмета його тримати не можна.
  const joins = plan.lessons
    .filter((l) => l.link)
    .map((l) => Markup.button.url(`🎥 ${l.startTime} ${shortName(l.subject?.name)}`, l.link!));

  const canEdit = plan.lessons.length > 0 && (await isStudent(ctx));
  await editOrSend(ctx, formatScheduleCaption(date, plan), navKeyboard(offset, joins, canEdit) as any, {
    render: () => renderDayCard(date, plan.lessons, plan.followsDayName ? `за ${plan.followsDayName.toLowerCase()}` : undefined),
  });
}

function scheduleHandler(bot: Telegraf): void {
  // Посилання на пару: у кожної своє, тому прив'язуємо до слота розкладу.
  bot.action(/^schlnk_(-?\d+)$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await isStudent(ctx))) return;
    const offset = Number((ctx as any).match![1]);
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const plan = await dayPlan(date);
    const rows = plan.lessons.map((l) => [
      Markup.button.callback(
        `${l.link ? "✅" : "➕"} ${l.startTime} ${shortName(l.subject?.name)}`,
        `schls_${l.dayOfWeek}_${l.slotNumber}_${l.even ? 1 : 0}_${offset}`
      ),
    ]);
    rows.push([Markup.button.callback("⬅️ Назад", `schd_${offset}`)]);
    await editOrSend(
      ctx,
      "🔗 <b>Посилання на пару</b>\nОберіть пару - і надішліть посилання наступним повідомленням.",
      Markup.inlineKeyboard(rows) as any
    );
  });

  bot.action(/^schls_(\d+)_(\d+)_(\d)_(-?\d+)$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await isStudent(ctx))) return;
    const m = (ctx as any).match as RegExpMatchArray;
    inputState.set(ctx.from!.id, {
      mode: "set_slot_link",
      dayOfWeek: Number(m[1]),
      slotNumber: Number(m[2]),
      even: m[3] === "1",
      offset: Number(m[4]),
    });
    await editOrSend(
      ctx,
      "🔗 Надішліть посилання на пару.\nЩоб прибрати збережене - надішліть <code>-</code>.",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Отмена", `schlnk_${m[4]}`)]]) as any
    );
  });

  // Command or main menu button
  bot.action("sch", async (ctx: Context) => {
    try {
      await showSchedule(ctx, 0);
    } catch (e) {
      console.error("[schedule error]", e);
    }
  });

  // Day navigation
  bot.action(/^schd_(-?\d+)$/, async (ctx: Context) => {
    try {
      const offset = parseInt((ctx as any).match![1]);
      await showSchedule(ctx, offset);
    } catch (e) {
      console.error("[schedule nav error]", e);
    }
  });
}

export default scheduleHandler;
