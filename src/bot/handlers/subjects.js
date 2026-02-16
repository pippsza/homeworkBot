const { Markup } = require("telegraf");
const { isAdmin } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const subjectService = require("../../services/subjectService");

function subjectEditMenu(subjectId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📘 Название", `esn_${subjectId}`)],
    [Markup.button.callback("😀 Emoji", `ese_${subjectId}`)],
    [Markup.button.callback("👨‍🏫 ФИО лектора", `esln_${subjectId}`)],
    [Markup.button.callback("📞 Контакты лектора", `eslc_${subjectId}`)],
    [Markup.button.callback("👩‍🏫 ФИО практики", `espn_${subjectId}`)],
    [Markup.button.callback("📞 Контакты практики", `espc_${subjectId}`)],
    [Markup.button.callback("✅ Готово", `subject_${subjectId}`)],
  ]);
}

function subjectsHandler(bot) {
  // List all subjects
  bot.action("subjects", async (ctx) => {
    const subjects = await subjectService.getAll();
    if (subjects.length === 0) {
      const buttons = [];
      if (await isAdmin(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить предмет", "add_subject"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
      return editOrSend(
        ctx,
        "😔 Нет предметов в списке.\n\n---",
        Markup.inlineKeyboard(buttons)
      );
    }

    let msg = "📋 Список предметов:\n\n";
    subjects.forEach((s) => {
      msg += `${s.emoji || "📚"} ${s.name}\n`;
    });
    msg += "\n---";

    const subjectButtons = [];
    for (let i = 0; i < subjects.length; i += 3) {
      subjectButtons.push(
        subjects
          .slice(i, i + 3)
          .map((s) => Markup.button.callback(s.emoji || "📚", `subject_${s._id}`))
      );
    }
    const buttons = [...subjectButtons];
    if (await isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // View single subject
  bot.action(/^subject_([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    const subject = await subjectService.getById(id);
    if (!subject) {
      return editOrSend(
        ctx,
        "❌ Предмет не найден.\n\n---",
        Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ Назад", "subjects")],
        ])
      );
    }

    let msg = `📘 Предмет: ${subject.name}\n\n`;
    if (subject.lecturerName) {
      msg += `👨‍🏫 Лектор: ${subject.lecturerName}${
        subject.lecturerContact ? ` (${subject.lecturerContact})` : ""
      }\n`;
    }
    if (subject.practitionerName) {
      msg += `👩‍🏫 Практик: ${subject.practitionerName}${
        subject.practitionerContact ? ` (${subject.practitionerContact})` : ""
      }\n`;
    }
    msg += "\n---\n";
    if (subject.tasks.length === 0) {
      msg += "😔 Нет заданий.\n";
    } else {
      msg += "📝 Задания:\n";
      subject.tasks.forEach((t) => {
        msg += `${t.emoji || "📄"} ${t.title}\n`;
      });
    }
    msg += "\n---";

    const taskButtons = [];
    for (let j = 0; j < subject.tasks.length; j += 3) {
      taskButtons.push(
        subject.tasks
          .slice(j, j + 3)
          .map((t) =>
            Markup.button.callback(t.emoji || "📄", `task_${t._id}`)
          )
      );
    }
    const buttons = [...taskButtons];
    if (await isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить задание", `add_task_${id}`),
      ]);
      buttons.push([
        Markup.button.callback("✏️ Редактировать", `esm_${id}`),
      ]);
      buttons.push([
        Markup.button.callback("🗑️ Удалить предмет", `src_${id}`),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "subjects")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // Confirm delete subject
  bot.action(/^src_([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    await editOrSend(
      ctx,
      "⚠️ Вы уверены, что хотите удалить предмет?\n\nЭто действие необратимо!\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `sry_${id}`)],
        [Markup.button.callback("❌ Нет, отменить", `subject_${id}`)],
      ])
    );
  });

  // Execute delete subject
  bot.action(/^sry_([a-f0-9]{24})$/, async (ctx) => {
    if (!(await isAdmin(ctx)))
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    const id = ctx.match[1];
    const removed = await subjectService.delete(id);
    if (!removed)
      return ctx.answerCbQuery("❌ Предмет не найден.", { show_alert: false });

    await ctx.answerCbQuery("✅ Предмет удалён");

    const subjects = await subjectService.getAll();
    const msg =
      subjects.length === 0
        ? `🗑️ Предмет ${removed.name} удалён.\n\n😔 Нет предметов.`
        : `🗑️ Предмет ${removed.name} удалён.\n\n📋 Список предметов:\n\n` +
          subjects.map((s) => `${s.emoji || "📚"} ${s.name}`).join("\n") +
          "\n\n---";

    const subjectButtons = [];
    for (let i = 0; i < subjects.length; i += 3) {
      subjectButtons.push(
        subjects
          .slice(i, i + 3)
          .map((s) => Markup.button.callback(s.emoji || "📚", `subject_${s._id}`))
      );
    }
    const buttons = [...subjectButtons];
    if (await isAdmin(ctx))
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // Add subject
  bot.action("add_subject", async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return trackSend(ctx, () =>
        ctx.reply("❌ Нет прав.", { disable_notification: !isPrivate(ctx) })
      );
    }
    inputState.set(ctx.from.id, {
      mode: "add_subject",
      step: "name",
      name: "",
      emoji: "",
      lecturerName: "",
      lecturerContact: "",
      practitionerName: "",
      practitionerContact: "",
    });
    await trackSend(ctx, () =>
      ctx.reply("📘 Введите название нового предмета:", {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("❌ Отмена", "subjects")],
        ]),
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  // Edit subject menu
  bot.action(/^esm_([a-f0-9]{24})$/, async (ctx) => {
    const id = ctx.match[1];
    await editOrSend(
      ctx,
      "✏️ Что хотите изменить в предмете?\n\n---",
      subjectEditMenu(id)
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
    bot.action(new RegExp(`^${pattern}_([a-f0-9]{24})$`), async (ctx) => {
      const subjectId = ctx.match[1];
      inputState.set(ctx.from.id, {
        mode: "edit_subject",
        step,
        subjectId,
      });
      await trackSend(ctx, () =>
        ctx.reply(prompt, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", `esm_${subjectId}`)],
          ]),
          disable_notification: !isPrivate(ctx),
        })
      );
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
    bot.action(action, async (ctx) => {
      const state = inputState.get(ctx.from.id);
      if (!state || state.mode !== "add_subject") return;
      state[field] = "";
      state.step = nextStep;
      await trackSend(ctx, () =>
        ctx.reply(prompt, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("Пропустить", nextSkip)],
          ]),
          disable_notification: !isPrivate(ctx),
        })
      );
    });
  }

  // Skip practitioner_contact — finalize subject creation
  bot.action("skip_practitioner_contact", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.mode !== "add_subject") return;
    state.practitionerContact = "";
    await subjectService.create({
      name: state.name,
      emoji: state.emoji || "📚",
      lecturerName: state.lecturerName,
      lecturerContact: state.lecturerContact,
      practitionerName: state.practitionerName,
      practitionerContact: state.practitionerContact,
      tasks: [],
    });
    inputState.delete(ctx.from.id);
    await trackSend(ctx, () =>
      ctx.reply("✅ Предмет добавлен!\n\n---", {
        disable_notification: !isPrivate(ctx),
      })
    );
    const { mainMenu } = require("./start");
    await mainMenu(ctx);
  });
}

module.exports = subjectsHandler;
module.exports.subjectEditMenu = subjectEditMenu;
