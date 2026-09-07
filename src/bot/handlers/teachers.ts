import { Telegraf, Context, Markup } from "telegraf";
import { isStudent } from "../middleware/auth";
import { editOrSend, notice } from "../helpers/editOrSend";
import { packRows } from "../helpers/buttonRows";
import * as inputState from "../helpers/inputState";
import * as teacherService from "../../services/teacherService";
import * as subjectService from "../../services/subjectService";
import { renderTeacherCard, renderTeachersList } from "../../services/scheduleImageService";

const FIELDS: { step: string; action: string; label: string; prompt: string }[] = [
  { step: "name", action: "etname", label: "📝 ПІБ", prompt: "Введіть повне ПІБ викладача:" },
  { step: "contact", action: "etcont", label: "📇 Контакт", prompt: "Введіть контакт (телеграм, пошта, телефон):" },
  { step: "chair", action: "etchair", label: "🏛 Кафедра", prompt: "Введіть кафедру:" },
  { step: "note", action: "etnote", label: "🧠 Нотатки", prompt: "Що варто памʼятати про викладача:" },
];

export async function showTeachers(ctx: Context): Promise<void> {
  const all = await teacherService.getAll();
  const rows = packRows(
    all.map((t) => {
      const label = `👤 ${t.short || teacherService.shortName(t.name)}`;
      return { btn: Markup.button.callback(label, `teacher_${t._id}`), label };
    })
  ) as any[][];
  if (await isStudent(ctx)) rows.push([Markup.button.callback("➕ Додати викладача", "add_teacher")]);
  rows.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
  await editOrSend(
    ctx,
    `👨‍🏫 <b>Викладачі</b> · ${all.length}`,
    Markup.inlineKeyboard(rows) as any,
    { render: renderTeachersList }
  );
}

async function showTeacher(ctx: Context, id: string): Promise<void> {
  const t = await teacherService.getById(id);
  if (!t) return showTeachers(ctx);
  const rows: any[][] = [];
  if (await isStudent(ctx)) {
    rows.push([
      Markup.button.callback("✏️ Змінити", `etm_teacher_${id}`),
      Markup.button.callback("🗑 Видалити", `dtr_${id}`),
    ]);
  }
  rows.push([Markup.button.callback("⬅️ До списку", "teachers")]);
  const contact = t.contact ? `\n📇 ${t.contact}` : "";
  await editOrSend(ctx, `👤 <b>${t.name}</b>${contact}`, Markup.inlineKeyboard(rows) as any, {
    render: () => renderTeacherCard(id),
  });
}

export default function teachersHandler(bot: Telegraf): void {
  bot.action("teachers", (ctx: Context) => showTeachers(ctx));
  bot.action(/^teacher_([a-f0-9]{24})$/, (ctx: Context) => showTeacher(ctx, (ctx as any).match![1]));

  bot.action("add_teacher", async (ctx: Context) => {
    if (!(await isStudent(ctx))) return notice(ctx, "❌ Нет прав.");
    inputState.set(ctx.from!.id, { mode: "add_teacher", step: "name" });
    await editOrSend(
      ctx,
      "👤 Введіть ПІБ викладача:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Скасувати", "teachers")]]) as any
    );
  });

  bot.action(/^etm_teacher_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    const id = (ctx as any).match![1];
    const rows = FIELDS.map((f) => [Markup.button.callback(f.label, `${f.action}_${id}`)]);
    rows.push([Markup.button.callback("✅ Готово", `teacher_${id}`)]);
    await editOrSend(ctx, "✏️ Що змінюємо?", Markup.inlineKeyboard(rows) as any);
  });

  for (const f of FIELDS) {
    bot.action(new RegExp(`^${f.action}_([a-f0-9]{24})$`), async (ctx: Context) => {
      if (!(await isStudent(ctx))) return notice(ctx, "❌ Нет прав.");
      const id = (ctx as any).match![1];
      inputState.set(ctx.from!.id, { mode: "edit_teacher", step: f.step, teacherId: id });
      await editOrSend(
        ctx,
        `✏️ ${f.prompt}\nЩоб очистити поле, надішліть <code>-</code>.`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ Скасувати", `etm_teacher_${id}`)]]) as any
      );
    });
  }

  bot.action(/^dtr_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return notice(ctx, "❌ Нет прав.");
    const id = (ctx as any).match![1];
    const used = await teacherService.subjectsOf(id);
    const tail = used.length ? `\n\nВін закріплений за: ${used.map((u) => u.name).join(", ")}` : "";
    await editOrSend(
      ctx,
      `⚠️ Видалити викладача?${tail}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Так", `dtry_${id}`)],
        [Markup.button.callback("❌ Ні", `teacher_${id}`)],
      ]) as any
    );
  });

  bot.action(/^dtry_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return notice(ctx, "❌ Нет прав.");
    await teacherService.remove((ctx as any).match![1]);
    await ctx.answerCbQuery("Видалено");
    await showTeachers(ctx);
  });

  // Прив'язка до предмета: обираємо зі списку, а не вписуємо ПІБ заново
  bot.action(/^pick_(lecturer|practitioner)_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await isStudent(ctx))) return;
    const m = (ctx as any).match as RegExpMatchArray;
    const all = await teacherService.getAll();
    const rows = packRows(
      all.map((t) => {
        const label = `👤 ${t.short || teacherService.shortName(t.name)}`;
        return { btn: Markup.button.callback(label, `set_${m[1]}_${m[2]}_${t._id}`), label };
      })
    ) as any[][];
    rows.push([Markup.button.callback("🚫 Прибрати", `set_${m[1]}_${m[2]}_none`)]);
    rows.push([Markup.button.callback("⬅️ Назад", `esm_${m[2]}`)]);
    await editOrSend(
      ctx,
      `👨‍🏫 Хто веде ${m[1] === "lecturer" ? "лекції" : "практику"}?`,
      Markup.inlineKeyboard(rows) as any
    );
  });

  bot.action(/^set_(lecturer|practitioner)_([a-f0-9]{24})_([a-f0-9]{24}|none)$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) return notice(ctx, "❌ Нет прав.");
    const m = (ctx as any).match as RegExpMatchArray;
    const teacher = m[3] === "none" ? null : await teacherService.getById(m[3]);
    // Дублюємо ім'я в старе рядкове поле: його читають картки і дайджести
    await subjectService.update(m[2], {
      [m[1]]: teacher?._id ?? null,
      [m[1] === "lecturer" ? "lecturerName" : "practitionerName"]: teacher?.name ?? "",
      [m[1] === "lecturer" ? "lecturerContact" : "practitionerContact"]: teacher?.contact ?? "",
    } as any);
    await ctx.answerCbQuery(teacher ? teacher.short || teacher.name : "Прибрано");
    const { showSubject } = await import("./subjects");
    await showSubject(ctx, m[2]);
  });
}
