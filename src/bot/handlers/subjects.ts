import { Telegraf, Context, Markup } from "telegraf";
import { isStudent, isSuperadmin } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate, notice } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";
import { renderSubjectCard, renderSubjectStrip, renderSubjectsList } from "../../services/scheduleImageService";
import { packRows } from "../helpers/buttonRows";
import * as subjectService from "../../services/subjectService";

function subjectEditMenu(subjectId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📘 Название", `esn_${subjectId}`)],
    [Markup.button.callback("😀 Emoji", `ese_${subjectId}`)],
    [Markup.button.callback("👨‍🏫 Лектор", `pick_lecturer_${subjectId}`)],
    [Markup.button.callback("👩‍🏫 Практик", `pick_practitioner_${subjectId}`)],
    [Markup.button.callback("✅ Готово", `subject_${subjectId}`)],
  ]);
}

/** Назва предмета на кнопку: довгі формулювання ріжемо. */
function shortSubject(name: string): string {
  const t = name
    .replace(/^Планування та адміністрування служб доступу$/i, "Служби доступу")
    .replace(/^Мат\. моделювання систем безпеки$/i, "Моделювання")
    .replace(/^Стеганографічний захист$/i, "Стеганографія")
    .replace(/^Реагування на кіберінциденти$/i, "Кіберінциденти");
  return t.length > 18 ? t.slice(0, 17) + "…" : t;
}

/**
 * Розкладка кнопок завдань. Порядок задає поле order, а завдання з
 * fullWidth займає весь рядок - так довгі назви не ріжуться.
 */
function layoutTasks(tasks: any[], columns: number): any[][] {
  const sorted = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return packRows(
    sorted.map((t) => {
      const label = `${t.emoji || "📄"} ${t.fullWidth ? t.title : shortTitle(t.title)}`;
      return { btn: Markup.button.callback(label, `task_${t._id}`), label, fullWidth: t.fullWidth };
    }),
    columns
  ) as any[][];
}

/** Коротка назва на кнопку: у ряд поміщається близько 15 символів. */
function shortTitle(title: string): string {
  const t = title
    .replace(/^Лабораторна робота\s*/i, "ЛР ")
    .replace(/^Контрольна робота\s*/i, "КР ")
    .replace(/^Підсумкова контрольна робота/i, "Підсумкова КР")
    .replace(/^Сертифікат Cisco.*/i, "Сертифікат Cisco")
    .replace(/^Курс Cisco.*/i, "Курс Cisco")
    .replace(/^Лекції.*/i, "Лекції")
    .replace(/^Матеріали.*/i, "Матеріали");
  return t.length > 16 ? t.slice(0, 15) + "…" : t;
}

/** Картка предмета. Винесена, щоб її могли перемалювати налаштування вигляду. */
/**
 * @param back куди веде «назад». За замовчуванням - список предметів, але з
 * розкладу передаємо `schd_<зміщення>`, щоб повернутись у той самий день.
 */
export async function showSubject(ctx: Context, id: string, back = "subjects"): Promise<void> {
    
    const subject = await subjectService.getById(id);
    if (!subject) {
      return editOrSend(
        ctx,
        "❌ Предмет не найден.\n\n---",
        Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ Назад", back)],
        ]) as any
      );
    }

    // Викладачі й перелік завдань є на картинці, тому підпис лишаємо коротким.
    const contacts = [subject.lecturerContact, subject.practitionerContact].filter(Boolean).join(" · ");
    const msg = `📘 <b>${subject.name}</b>` + (contacts ? `\n${contacts}` : "");

    const taskButtons = layoutTasks(subject.tasks, subject.buttonColumns ?? 0);
    const buttons = [...taskButtons];

    // Classroom один на предмет, а посилання на Teams у кожної пари своє -
    // воно живе в розкладі, не тут.
    const links: any[] = [];
    if (subject.classroomUrl) links.push(Markup.button.url("🎓 Classroom", subject.classroomUrl));
    const chats = ((subject as any).chats || []) as { title: string; url: string }[];
    if (chats.length) {
      for (const c of chats) links.push(Markup.button.url(`💬 ${c.title}`, c.url));
    } else if ((subject as any).telegramUrl) {
      links.push(Markup.button.url("💬 Група", (subject as any).telegramUrl));
    }
    if (links.length) {
      buttons.push(...(packRows(links.map((b) => ({ btn: b, label: b.text }))) as any[][]));
    }
    // Дії одним рядком іконок: підписи тут нічого не додають, а рядків їдять багато.
    const actions = [Markup.button.callback("⬅️", back), Markup.button.callback("🖼", `subjimg_${id}`)];
    if (await isStudent(ctx)) {
      actions.push(
        Markup.button.callback("➕", `add_task_${id}`),
        Markup.button.callback("✏️", `esm_${id}`),
        Markup.button.callback("⚙️", `cols_${id}`),
        Markup.button.callback("🗑", `src_${id}`)
      );
    }
    buttons.push(actions);
    // Відмітку «здано» бачить лише суперадмін: це його особистий облік
    const showDone = await isSuperadmin(ctx);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any, {
      render: () => renderSubjectStrip(id, showDone),
    });
}

function subjectsHandler(bot: Telegraf): void {
  // List all subjects
  bot.action("subjects", async (ctx: Context) => {
    const subjects = await subjectService.getAll();
    if (subjects.length === 0) {
      const buttons = [];
      if (await isStudent(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить предмет", "add_subject"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
      return editOrSend(
        ctx,
        "😔 Нет предметов в списке.\n\n---",
        Markup.inlineKeyboard(buttons) as any
      );
    }

    // Список - на картинці, у підписі його дублювати не треба.
    const msg = `📋 <b>Предмети</b> · ${subjects.length}`;

    const subjectButtons = packRows(
      subjects.map((s: any) => {
        const label = `${s.emoji || "📚"} ${shortSubject(s.name)}`;
        return { btn: Markup.button.callback(label, `subject_${s._id}`), label };
      })
    ) as any[][];
    const buttons = [...subjectButtons];
    if (await isStudent(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    const showDone = await isSuperadmin(ctx);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any, {
      render: () => renderSubjectsList(showDone),
    });
  });

  // View single subject
  bot.action(/^subject_([a-f0-9]{24})$/, (ctx: Context) => showSubject(ctx, (ctx as any).match![1]));
  // Вхід у предмет із розкладу: зміщення дня їде разом, щоб «назад» повернуло
  // в розклад на той самий день, а не в загальний список предметів.
  bot.action(/^subjsch_([a-f0-9]{24})_(-?\d+)$/, (ctx: Context) => {
    const m = (ctx as any).match!;
    return showSubject(ctx, m[1], `schd_${m[2]}`);
  });


  // Confirm delete subject
  bot.action(/^src_([a-f0-9]{24})$/, async (ctx: Context) => {
    const id = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "⚠️ Вы уверены, что хотите удалить предмет?\n\nЭто действие необратимо!\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `sry_${id}`)],
        [Markup.button.callback("❌ Нет, отменить", `subject_${id}`)],
      ]) as any
    );
  });

  // Execute delete subject
  bot.action(/^sry_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx)))
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    const id = (ctx as any).match![1];
    const removed = await subjectService.delete(id);
    if (!removed)
      return ctx.answerCbQuery("❌ Предмет не найден.", { show_alert: false });

    await ctx.answerCbQuery("✅ Предмет удалён");

    const subjects = await subjectService.getAll();
    const msg =
      subjects.length === 0
        ? `🗑️ Предмет ${removed.name} удалён.\n\n😔 Нет предметов.`
        : `🗑️ Предмет ${removed.name} удалён.\n\n📋 Список предметов:\n\n` +
          subjects.map((s: any) => `${s.emoji || "📚"} ${s.name}`).join("\n") +
          "\n\n---";

    const subjectButtons = packRows(
      subjects.map((s: any) => {
        const label = `${s.emoji || "📚"} ${shortSubject(s.name)}`;
        return { btn: Markup.button.callback(label, `subject_${s._id}`), label };
      })
    ) as any[][];
    const buttons = [...subjectButtons];
    if (await isStudent(ctx))
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  // Add subject
  bot.action("add_subject", async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return notice(ctx, "❌ Нет прав.");
    }
    inputState.set(ctx.from!.id, {
      mode: "add_subject",
      step: "name",
      name: "",
      emoji: "",
      lecturerName: "",
      lecturerContact: "",
      practitionerName: "",
      practitionerContact: "",
    });
    await editOrSend(ctx, "📘 Введите название нового предмета:", Markup.inlineKeyboard([
          [Markup.button.callback("❌ Отмена", "subjects")],
        ]) as any);
  });

  // Edit subject menu
  bot.action(/^esm_([a-f0-9]{24})$/, async (ctx: Context) => {
    const id = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "✏️ Что хотите изменить в предмете?\n\n---",
      subjectEditMenu(id) as any
    );
  });

  // Edit subject fields - set inputState
  const editFields = [
    { pattern: "esn", step: "name", prompt: "📘 Введите новое название:" },
    { pattern: "ese", step: "emoji", prompt: "😀 Введите новый emoji:" },
    {
      pattern: "esln",
      step: "lecturer_name",
      prompt: "👨‍🏫 Введите новое ФИО лектора:",
    },
    {
      pattern: "eslc",
      step: "lecturer_contact",
      prompt: "📞 Введите новые контакты лектора:",
    },
    {
      pattern: "espn",
      step: "practitioner_name",
      prompt: "👩‍🏫 Введите новое ФИО практики:",
    },
    {
      pattern: "espc",
      step: "practitioner_contact",
      prompt: "📞 Введите новые контакты практики:",
    },
  ];

  for (const { pattern, step, prompt } of editFields) {
    bot.action(new RegExp(`^${pattern}_([a-f0-9]{24})$`), async (ctx: Context) => {
      const subjectId = (ctx as any).match![1];
      inputState.set(ctx.from!.id, {
        mode: "edit_subject",
        step,
        subjectId,
      });
      await editOrSend(ctx, prompt, Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", `esm_${subjectId}`)],
          ]) as any);
    });
  }

  // Skip handlers for add_subject flow
  const skipSteps = [
    {
      action: "skip_lecturer_name",
      field: "lecturerName",
      nextStep: "lecturer_contact",
      prompt:
        "📞 Введите контакты лектора (соц. сети, почта и т.д.) (или пропустите):",
      nextSkip: "skip_lecturer_contact",
    },
    {
      action: "skip_lecturer_contact",
      field: "lecturerContact",
      nextStep: "practitioner_name",
      prompt: "👩‍🏫 Введите ФИО практики (или пропустите):",
      nextSkip: "skip_practitioner_name",
    },
    {
      action: "skip_practitioner_name",
      field: "practitionerName",
      nextStep: "practitioner_contact",
      prompt:
        "📞 Введите контакты практики (соц. сети, почта и т.д.) (или пропустите):",
      nextSkip: "skip_practitioner_contact",
    },
  ];

  for (const { action, field, nextStep, prompt, nextSkip } of skipSteps) {
    bot.action(action, async (ctx: Context) => {
      const state = inputState.get(ctx.from!.id);
      if (!state || state.mode !== "add_subject") return;
      state[field] = "";
      state.step = nextStep;
      await editOrSend(ctx, prompt, Markup.inlineKeyboard([
            [Markup.button.callback("Пропустить", nextSkip)],
          ]) as any);
    });
  }

  // Skip practitioner_contact — finalize subject creation
  bot.action("skip_practitioner_contact", async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state || state.mode !== "add_subject") return;
    state.practitionerContact = "";
    await subjectService.create({
      name: state.name,
      emoji: state.emoji || "📚",
      lecturerName: state.lecturerName,
      lecturerContact: state.lecturerContact,
      practitionerName: state.practitionerName,
      practitionerContact: state.practitionerContact,
      tasks: [] as any,
    });
    inputState.delete(ctx.from!.id);
    await editOrSend(ctx, "✅ Предмет добавлен!\n\n---");
    const { mainMenu } = await import("./start");
    await mainMenu(ctx);
  });
}

export default subjectsHandler;
export { subjectEditMenu };
