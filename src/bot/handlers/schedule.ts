import { Telegraf, Context, Markup } from "telegraf";
import { editOrSend } from "../helpers/editOrSend";
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

function navKeyboard(offset: number, joins: any[] = []) {
  return Markup.inlineKeyboard([
    ...joins.map((b) => [b]),
    [
      Markup.button.callback("◀️", `schd_${offset - 1}`),
      Markup.button.callback("Сегодня", "sch"),
      Markup.button.callback("▶️", `schd_${offset + 1}`),
    ],
    [Markup.button.callback("🏠 Меню", "main_menu")],
  ]);
}

async function showSchedule(ctx: Context, offset: number = 0): Promise<void> {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const plan = await dayPlan(date);
  // Посилання на пару: беремо збережене в слоті, інакше загальне у предмета.
  const joins: any[] = [];
  const seen = new Set<string>();
  for (const l of plan.lessons) {
    const url = (l as any).link || (l.subject as any)?.teamsLink;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    joins.push(Markup.button.url(`🎥 ${l.startTime} ${shortName(l.subject?.name)}`, url));
  }

  await editOrSend(ctx, formatScheduleCaption(date, plan), navKeyboard(offset, joins) as any, {
    render: () => renderDayCard(date, plan.lessons, plan.followsDayName ? `за ${plan.followsDayName.toLowerCase()}` : undefined),
  });
}

function scheduleHandler(bot: Telegraf): void {
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
