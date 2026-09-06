import { Telegraf, Context, Markup } from "telegraf";
import { isStudent } from "../middleware/auth";
import { editOrSend } from "../helpers/editOrSend";
import Subject from "../../models/Subject";
import { showSubject } from "./subjects";

/** Порядок кнопок і ширина рядка налаштовуються прямо з бота. */
export default function layoutHandler(bot: Telegraf): void {
  // Скільки колонок у предмета
  bot.action(/^cols_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await isStudent(ctx))) return;
    const id = (ctx as any).match![1];
    const subj = await Subject.findById(id);
    if (!subj) return;
    const cur = subj.buttonColumns || 2;
    const rows = [
      [1, 2, 3].map((n) =>
        Markup.button.callback(n === cur ? `• ${n} •` : String(n), `colsset_${id}_${n}`)
      ),
      [Markup.button.callback("⬅️ Назад", `subject_${id}`)],
    ];
    await editOrSend(
      ctx,
      `⚙️ <b>${subj.name}</b>\n\nСкільки кнопок завдань ставити в рядок?\nЗараз: ${cur}`,
      Markup.inlineKeyboard(rows) as any
    );
  });

  bot.action(/^colsset_([a-f0-9]{24})_(\d)$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return;
    const m = (ctx as any).match as RegExpMatchArray;
    await Subject.updateOne({ _id: m[1] }, { buttonColumns: Number(m[2]) });
    await ctx.answerCbQuery(`Колонок: ${m[2]}`);
    await showSubject(ctx, m[1]);
  });

  // Порядок і ширина конкретного завдання
  bot.action(/^tlay_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await isStudent(ctx))) return;
    const taskId = (ctx as any).match![1];
    const subj = await Subject.findOne({ "tasks._id": taskId });
    if (!subj) return;
    const task = subj.tasks.id(taskId);
    if (!task) return;
    const rows = [
      [
        Markup.button.callback("⬆️ Вище", `tmove_${taskId}_up`),
        Markup.button.callback("⬇️ Нижче", `tmove_${taskId}_dn`),
      ],
      [
        Markup.button.callback(
          (task as any).fullWidth ? "↔️ На всю ширину: так" : "↔️ На всю ширину: ні",
          `tfw_${taskId}`
        ),
      ],
      [Markup.button.callback("⬅️ До завдання", `task_${taskId}`)],
    ];
    await editOrSend(
      ctx,
      `⚙️ <b>${task.title}</b>\n\nПозиція в списку: ${((task as any).order ?? 0) + 1}`,
      Markup.inlineKeyboard(rows) as any
    );
  });

  bot.action(/^tmove_([a-f0-9]{24})_(up|dn)$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return;
    const m = (ctx as any).match as RegExpMatchArray;
    const subj = await Subject.findOne({ "tasks._id": m[1] });
    if (!subj) return;

    // Нормалізуємо порядок: у старих завдань order нульовий у всіх
    const sorted = [...subj.tasks].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    sorted.forEach((t: any, i: number) => (t.order = i));
    const idx = sorted.findIndex((t: any) => String(t._id) === m[1]);
    const to = m[2] === "up" ? idx - 1 : idx + 1;
    if (to < 0 || to >= sorted.length) {
      return ctx.answerCbQuery("Уже скраю");
    }
    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[to].order;
    sorted[to].order = tmp;
    await subj.save();
    await ctx.answerCbQuery("Переміщено");
    await showSubject(ctx, String(subj._id));
  });

  bot.action(/^tfw_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return;
    const taskId = (ctx as any).match![1];
    const subj = await Subject.findOne({ "tasks._id": taskId });
    if (!subj) return;
    const task: any = subj.tasks.id(taskId);
    task.fullWidth = !task.fullWidth;
    await subj.save();
    await ctx.answerCbQuery(task.fullWidth ? "На всю ширину" : "Звичайна ширина");
  });
}
