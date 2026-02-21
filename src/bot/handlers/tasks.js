const { Markup } = require("telegraf");
const { isStudent } = require("../middleware/auth");
const { editOrSend, trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const subjectService = require("../../services/subjectService");

function taskEditMenu(taskId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📝 Заголовок", `ett_${taskId}`)],
    [Markup.button.callback("😀 Emoji", `ete_${taskId}`)],
    [Markup.button.callback("📄 Описание", `etd_${taskId}`)],
    [Markup.button.callback("📎 Вложения", `eta_${taskId}`)],
    [Markup.button.callback("✅ Готово", `task_${taskId}`)],
  ]);
}

async function showTask(ctx, taskId) {
  const { subject, task } = await subjectService.getTask(taskId);
  if (!task) {
    return editOrSend(
      ctx,
      "❌ Задание не найдено.\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ Назад", "subjects")],
      ])
    );
  }

  let msg = `*📄 ${task.title}*\n\n`;
  if (task.description) msg += `${task.description}\n\n---\n`;

  const buttons = [];
  if ((await isStudent(ctx)) && task.answers?.length) {
    buttons.push([
      Markup.button.callback("📖 Показать ответы", `sa_${taskId}`),
    ]);
  }
  if (task.attachments && task.attachments.length > 0) {
    buttons.push([
      Markup.button.callback(
        `📎 Вложения (${task.attachments.length})`,
        `sha_${taskId}`
      ),
    ]);
  }
  if (await isStudent(ctx)) {
    buttons.push([
      Markup.button.callback("➕ Добавить ответ", `aa_${taskId}`),
    ]);
    buttons.push([
      Markup.button.callback("🗑️ Удалить задание", `trc_${taskId}`),
    ]);
    buttons.push([
      Markup.button.callback("✏️ Редактировать", `etm_${taskId}`),
    ]);
  }
  buttons.push([
    Markup.button.callback("⬅️ Назад", `subject_${subject._id}`),
  ]);
  await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
}

function tasksHandler(bot) {
  // View task
  bot.action(/^task_([a-f0-9]{24})$/, async (ctx) => {
    await showTask(ctx, ctx.match[1]);
  });

  // Confirm delete task
  bot.action(/^trc_([a-f0-9]{24})$/, async (ctx) => {
    const taskId = ctx.match[1];
    await editOrSend(
      ctx,
      "⚠️ Вы уверены, что хотите удалить задание?\n\nЭто действие необратимо!\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `try_${taskId}`)],
        [Markup.button.callback("❌ Нет, отменить", `task_${taskId}`)],
      ])
    );
  });

  // Execute delete task
  bot.action(/^try_([a-f0-9]{24})$/, async (ctx) => {
    if (!(await isStudent(ctx)))
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    const taskId = ctx.match[1];
    const result = await subjectService.deleteTask(taskId);
    if (!result)
      return ctx.answerCbQuery("❌ Задание не найдено.", { show_alert: false });

    await ctx.answerCbQuery("✅ Задание удалено");

    const subject = result.subject;
    let msg = `🗑️ Задание "${result.title}" удалено.\n\n📘 Предмет: ${subject.name}\n\n`;
    if (subject.tasks.length === 0) {
      msg += "😔 Нет заданий.\n";
    } else {
      msg +=
        "📝 Задания:\n" +
        subject.tasks.map((t) => `${t.emoji || "📄"} ${t.title}`).join("\n");
    }
    msg += "\n\n---";

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
    if (await isStudent(ctx)) {
      buttons.push([
        Markup.button.callback(
          "➕ Добавить задание",
          `add_task_${subject._id}`
        ),
      ]);
      buttons.push([
        Markup.button.callback("✏️ Редактировать", `esm_${subject._id}`),
      ]);
      buttons.push([
        Markup.button.callback("🗑️ Удалить предмет", `src_${subject._id}`),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "subjects")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // Show attachments
  bot.action(/^sha_([a-f0-9]{24})$/, async (ctx) => {
    const { task } = await subjectService.getTask(ctx.match[1]);
    if (!task?.attachments?.length) return;
    for (const att of task.attachments) {
      try {
        if (att.type === "photo") {
          await trackSend(ctx, () =>
            ctx.replyWithPhoto(att.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        } else if (att.type === "document") {
          await trackSend(ctx, () =>
            ctx.replyWithDocument(att.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      } catch (e) {
        console.error("[send attachment error]", e);
      }
    }
  });

  // Show answers
  bot.action(/^sa_([a-f0-9]{24})$/, async (ctx) => {
    if (!(await isStudent(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const { task } = await subjectService.getTask(ctx.match[1]);
    if (!task?.answers?.length && !task?.aiAnswerFiles?.length) {
      return ctx.answerCbQuery("❌ Нет ответов.");
    }
    // Send AI-generated files (LaTeX etc.)
    if (task.aiAnswerFiles?.length) {
      for (const file of task.aiAnswerFiles) {
        try {
          await trackSend(ctx, () =>
            ctx.replyWithDocument(
              { source: Buffer.from(file.content, "utf-8"), filename: file.filename },
              {
                caption: `📄 AI: ${file.filename}`,
                disable_notification: !isPrivate(ctx),
              }
            )
          );
        } catch (e) {
          console.error("[show_answers ai-file error]", e);
        }
      }
    }
    // Send regular answers
    for (const ans of (task.answers || [])) {
      try {
        if (ans.type === "text") {
          await trackSend(ctx, () =>
            ctx.reply(ans.content, { disable_notification: !isPrivate(ctx) })
          );
        } else if (ans.type === "photo") {
          await trackSend(ctx, () =>
            ctx.replyWithPhoto(ans.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        } else if (ans.type === "document") {
          await trackSend(ctx, () =>
            ctx.replyWithDocument(ans.file_id, {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      } catch (e) {
        console.error("[show_answers error]", e);
      }
    }
    await ctx.answerCbQuery();
  });

  // Add task
  bot.action(/^add_task_([a-f0-9]{24})$/, async (ctx) => {
    if (!(await isStudent(ctx))) {
      return trackSend(ctx, () =>
        ctx.reply("❌ Нет прав.", { disable_notification: !isPrivate(ctx) })
      );
    }
    const subjectId = ctx.match[1];
    inputState.set(ctx.from.id, {
      mode: "add_task",
      step: "title",
      subjectId,
      title: "",
      description: "",
      attachments: [],
      emoji: "",
    });
    await trackSend(ctx, () =>
      ctx.reply("📝 Введите заголовок задания:", {
        ...Markup.inlineKeyboard([
          [Markup.button.callback("❌ Отмена", `subject_${subjectId}`)],
        ]),
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  // Add answer
  bot.action(/^aa_([a-f0-9]{24})$/, async (ctx) => {
    if (!(await isStudent(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const taskId = ctx.match[1];
    inputState.set(ctx.from.id, {
      mode: "add_answer",
      step: "answer",
      taskId,
      answers: [],
    });
    await editOrSend(
      ctx,
      "➕ Добавьте ответ(ы) к задаче.\n\nМожете отправить текст, фото или документы. Когда закончите, нажмите '✅ Готово'.\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Готово", `fa_${taskId}`)],
        [Markup.button.callback("❌ Отмена", `task_${taskId}`)],
      ])
    );
  });

  // Finish answer
  bot.action(/^fa_([a-f0-9]{24})$/, async (ctx) => {
    const state = inputState.get(ctx.from.id);
    const taskId = ctx.match[1];
    if (!state || state.taskId !== taskId || state.mode !== "add_answer") {
      return ctx.answerCbQuery("❌ Ошибка состояния.");
    }
    if (state.answers.length === 0) {
      return ctx.answerCbQuery("❌ Нет добавленных ответов.");
    }
    for (const ans of state.answers) {
      await subjectService.addAnswer(taskId, ans);
    }
    inputState.delete(ctx.from.id);
    await ctx.answerCbQuery("✅ Ответ(ы) добавлены.");
    await showTask(ctx, taskId);
  });

  // Task edit menu
  bot.action(/^etm_([a-f0-9]{24})$/, async (ctx) => {
    const taskId = ctx.match[1];
    await editOrSend(
      ctx,
      "✏️ Что хотите изменить в задании?\n\n---",
      taskEditMenu(taskId)
    );
  });

  // Edit task fields
  const editTaskFields = [
    { pattern: "ett", step: "edit_title", prompt: "📝 Введите новый заголовок:" },
    { pattern: "ete", step: "edit_emoji", prompt: "😀 Введите новый emoji:" },
    {
      pattern: "etd",
      step: "edit_description",
      prompt: "📄 Введите новое описание:",
    },
  ];

  for (const { pattern, step, prompt } of editTaskFields) {
    bot.action(new RegExp(`^${pattern}_([a-f0-9]{24})$`), async (ctx) => {
      const taskId = ctx.match[1];
      inputState.set(ctx.from.id, { mode: "edit_task", step, taskId });
      await trackSend(ctx, () =>
        ctx.reply(prompt, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", `etm_${taskId}`)],
          ]),
          disable_notification: !isPrivate(ctx),
        })
      );
    });
  }

  // Edit task attachments
  bot.action(/^eta_([a-f0-9]{24})$/, async (ctx) => {
    const taskId = ctx.match[1];
    inputState.set(ctx.from.id, {
      mode: "edit_task",
      step: "attachments",
      taskId,
      attachments: [],
    });
    await trackSend(ctx, () =>
      ctx.reply(
        '📎 Отправьте новые файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fta_${taskId}`)],
          ]),
          disable_notification: !isPrivate(ctx),
        }
      )
    );
  });

  // Finish task attachments (add or edit)
  bot.action(/^fta_([a-f0-9]{24})$/, async (ctx) => {
    const state = inputState.get(ctx.from.id);
    const taskId = ctx.match[1];
    if (!state) return;

    if (state.mode === "add_task") {
      await subjectService.addTask(state.subjectId, {
        title: state.title,
        emoji: state.emoji || "📄",
        description: state.description,
        attachments: state.attachments,
        answers: [],
      });
      inputState.delete(ctx.from.id);
      await trackSend(ctx, () =>
        ctx.reply("✅ Задание сохранено!\n\n---", {
          disable_notification: !isPrivate(ctx),
        })
      );
      const { mainMenu } = require("./start");
      await mainMenu(ctx);
    } else if (state.mode === "edit_task" && state.step === "attachments") {
      await subjectService.setTaskAttachments(taskId, state.attachments);
      inputState.delete(ctx.from.id);
      await trackSend(ctx, () =>
        ctx.reply("✅ Вложения обновлены!\n\n---", {
          disable_notification: !isPrivate(ctx),
        })
      );
      await showTask(ctx, taskId);
    }
  });

  // Skip description for tasks
  bot.action(/^skd_([a-f0-9]{24})$/, async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state || state.step !== "description") return;
    state.description = "";
    state.step = "attachments";
    const finishId =
      state.mode === "add_task" ? state.subjectId : state.taskId;
    await trackSend(ctx, () =>
      ctx.reply(
        '📎 Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fta_${finishId}`)],
          ]),
          disable_notification: !isPrivate(ctx),
        }
      )
    );
  });
}

module.exports = tasksHandler;
module.exports.showTask = showTask;
module.exports.taskEditMenu = taskEditMenu;
