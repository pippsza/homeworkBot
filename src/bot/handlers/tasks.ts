import { Telegraf, Context, Markup } from "telegraf";
import { isStudent } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate, notice } from "../helpers/editOrSend";
import * as inputState from "../helpers/inputState";
import * as subjectService from "../../services/subjectService";
import { renderTaskCard } from "../../services/scheduleImageService";

/**
 * Показуємо файл у поточному повідомленні: editMessageMedia міняє медіа на
 * медіа будь-якого типу, тому картка і вкладення живуть в одному вікні.
 * Якщо файл недоступний (наприклад, file_id від іншого бота), лишаємо вікно
 * на місці й кажемо про це спливаючим написом - інакше екран просто зникає.
 */
async function swapMedia(
  ctx: Context,
  media: { type: "photo" | "document"; media: any },
  keyboard: any
): Promise<void> {
  try {
    await ctx.editMessageMedia(media as any, { reply_markup: keyboard.reply_markup } as any);
  } catch (e) {
    console.error("[attachments] swap failed:", (e as Error).message);
    await ctx.answerCbQuery("Не вдалося відкрити файл", { show_alert: true }).catch(() => {});
  }
}

/** Кнопки гортання вкладень: номер поточного файла і повернення до завдання. */
function attachmentKeyboard(taskId: string, idx: number, total: number) {
  const rows: any[] = [];
  if (total > 1) {
    const prev = (idx - 1 + total) % total;
    const next = (idx + 1) % total;
    rows.push([
      Markup.button.callback("◀️", `att_${taskId}_${prev}`),
      Markup.button.callback(`${idx + 1}/${total}`, "noop"),
      Markup.button.callback("▶️", `att_${taskId}_${next}`),
    ]);
  }
  rows.push([Markup.button.callback("⬅️ До завдання", `attback_${taskId}`)]);
  return Markup.inlineKeyboard(rows);
}

function taskEditMenu(taskId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📝 Заголовок", `ett_${taskId}`)],
    [Markup.button.callback("😀 Emoji", `ete_${taskId}`)],
    [Markup.button.callback("📄 Описание", `etd_${taskId}`)],
    [Markup.button.callback("📎 Вложения", `eta_${taskId}`)],
    [Markup.button.callback("✅ Готово", `task_${taskId}`)],
  ]);
}

async function showTask(ctx: Context, taskId: string): Promise<void> {
  const { subject, task } = await subjectService.getTask(taskId);
  if (!task) {
    return editOrSend(
      ctx,
      "❌ Завдання не знайдено.\n\n---",
      Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", "subjects")]]) as any
    );
  }

  const buttons: any[][] = [];
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
  const actions = [Markup.button.callback("⬅️", `subject_${subject!._id}`)];
  if (await isStudent(ctx)) {
    actions.push(
      Markup.button.callback("➕", `aa_${taskId}`),
      Markup.button.callback("✏️", `etm_${taskId}`),
      Markup.button.callback("⚙️", `tlay_${taskId}`),
      Markup.button.callback("🗑", `trc_${taskId}`)
    );
  }
  buttons.push(actions);
  // Посилання з опису виносимо кнопками: на картинці вони не натискаються.
  const links = extractLinks(`${task.title} ${task.description || ""}`);
  if (links.length) {
    buttons.unshift(links.map((u) => Markup.button.url(`🔗 ${linkLabel(u)}`, u)));
  }

  await editOrSend(ctx, taskCaption(task), Markup.inlineKeyboard(buttons) as any, {
    render: () => renderTaskCard(subject!.name, task),
  });
}

const CAPTION_LIMIT = 1024;

function taskCaption(task: any): string {
  const head = `${task.emoji || "📌"} <b>${escapeHtml(task.title)}</b>`;
  const due = task.deadline ? `\n🗓 До ${new Date(task.deadline).toLocaleDateString("uk-UA")}` : "";
  const body = task.description ? `\n\n${escapeHtml(task.description)}` : "";
  const caption = head + due + body;
  return caption.length <= CAPTION_LIMIT ? caption : caption.slice(0, CAPTION_LIMIT - 1) + "…";
}

function extractLinks(text: string): string[] {
  const found = String(text).match(/https?:\/\/[^\s<>"')]+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;]+$/, "")))].slice(0, 3);
}

function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Посилання";
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tasksHandler(bot: Telegraf): void {
  // View task
  bot.action(/^task_([a-f0-9]{24})$/, async (ctx: Context) => {
    await showTask(ctx, (ctx as any).match![1]);
  });

  // Confirm delete task
  bot.action(/^trc_([a-f0-9]{24})$/, async (ctx: Context) => {
    const taskId = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "⚠️ Вы уверены, что хотите удалить задание?\n\nЭто действие необратимо!\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Да, удалить", `try_${taskId}`)],
        [Markup.button.callback("❌ Нет, отменить", `task_${taskId}`)],
      ]) as any
    );
  });

  // Execute delete task
  bot.action(/^try_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx)))
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    const taskId = (ctx as any).match![1];
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
        subject.tasks.map((t: any) => `${t.emoji || "📄"} ${t.title}`).join("\n");
    }
    msg += "\n\n---";

    const taskButtons: any[][] = [];
    for (let j = 0; j < subject.tasks.length; j += 3) {
      taskButtons.push(
        subject.tasks
          .slice(j, j + 3)
          .map((t: any) =>
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
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons) as any);
  });

  // Вкладення показуємо по одному в тому самому повідомленні: editMessageMedia
  // вміє замінити документ на документ, тому чат не забивається файлами.
  bot.action(/^sha_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    const taskId = (ctx as any).match![1];
    const { task } = await subjectService.getTask(taskId);
    if (!task?.attachments?.length) return;
    const att = task.attachments[0];
    await swapMedia(
      ctx,
      { type: att.type === "photo" ? "photo" : "document", media: att.file_id },
      attachmentKeyboard(taskId, 0, task.attachments.length)
    );
  });

  bot.action(/^att_([a-f0-9]{24})_(\d+)$/, async (ctx: Context) => {
    const m = (ctx as any).match as RegExpMatchArray;
    const taskId = m[1];
    const idx = Number(m[2]);
    const { task } = await subjectService.getTask(taskId);
    if (!task?.attachments?.length) return;
    const total = task.attachments.length;
    const att = task.attachments[((idx % total) + total) % total];
    await ctx.answerCbQuery().catch(() => {});
    await ctx
      .editMessageMedia(
        { type: att.type === "photo" ? "photo" : "document", media: att.file_id } as any,
        { reply_markup: attachmentKeyboard(taskId, idx, total).reply_markup } as any
      )
      .catch(() => {});
  });

  // Повернення до завдання: повідомлення з файлом текстом не стає, тому
  // прибираємо його і малюємо картку заново.
  bot.action(/^attback_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    await showTask(ctx, (ctx as any).match![1]);
  });

  // Show answers
  bot.action(/^sa_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const { task } = await subjectService.getTask((ctx as any).match![1]);
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
          await editOrSend(ctx, ans.content);
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
  bot.action(/^add_task_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return notice(ctx, "❌ Нет прав.");
    }
    const subjectId = (ctx as any).match![1];
    inputState.set(ctx.from!.id, {
      mode: "add_task",
      step: "title",
      subjectId,
      title: "",
      description: "",
      attachments: [],
      emoji: "",
    });
    await editOrSend(ctx, "📝 Введите заголовок задания:", Markup.inlineKeyboard([
          [Markup.button.callback("❌ Отмена", `subject_${subjectId}`)],
        ]) as any);
  });

  // Add answer
  bot.action(/^aa_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const taskId = (ctx as any).match![1];
    inputState.set(ctx.from!.id, {
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
      ]) as any
    );
  });

  // Finish answer
  bot.action(/^fa_([a-f0-9]{24})$/, async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    const taskId = (ctx as any).match![1];
    if (!state || state.taskId !== taskId || state.mode !== "add_answer") {
      return ctx.answerCbQuery("❌ Ошибка состояния.");
    }
    if (state.answers.length === 0) {
      return ctx.answerCbQuery("❌ Нет добавленных ответов.");
    }
    for (const ans of state.answers) {
      await subjectService.addAnswer(taskId, ans);
    }
    inputState.delete(ctx.from!.id);
    await ctx.answerCbQuery("✅ Ответ(ы) добавлены.");
    await showTask(ctx, taskId);
  });

  // Task edit menu
  bot.action(/^etm_([a-f0-9]{24})$/, async (ctx: Context) => {
    const taskId = (ctx as any).match![1];
    await editOrSend(
      ctx,
      "✏️ Что хотите изменить в задании?\n\n---",
      taskEditMenu(taskId) as any
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
    bot.action(new RegExp(`^${pattern}_([a-f0-9]{24})$`), async (ctx: Context) => {
      const taskId = (ctx as any).match![1];
      inputState.set(ctx.from!.id, { mode: "edit_task", step, taskId });
      await editOrSend(ctx, prompt, Markup.inlineKeyboard([
            [Markup.button.callback("❌ Отмена", `etm_${taskId}`)],
          ]) as any);
    });
  }

  // Edit task attachments
  bot.action(/^eta_([a-f0-9]{24})$/, async (ctx: Context) => {
    const taskId = (ctx as any).match![1];
    inputState.set(ctx.from!.id, {
      mode: "edit_task",
      step: "attachments",
      taskId,
      attachments: [],
    });
    await editOrSend(ctx, '📎 Отправьте новые файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---', Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fta_${taskId}`)],
          ]) as any);
  });

  // Finish task attachments (add or edit)
  bot.action(/^fta_([a-f0-9]{24})$/, async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    const taskId = (ctx as any).match![1];
    if (!state) return;

    if (state.mode === "add_task") {
      await subjectService.addTask(state.subjectId, {
        title: state.title,
        emoji: state.emoji || "📄",
        description: state.description,
        attachments: state.attachments,
        answers: [],
      });
      inputState.delete(ctx.from!.id);
      await editOrSend(ctx, "✅ Задание сохранено!\n\n---");
      const { mainMenu } = await import("./start");
      await mainMenu(ctx);
    } else if (state.mode === "edit_task" && state.step === "attachments") {
      await subjectService.setTaskAttachments(taskId, state.attachments);
      inputState.delete(ctx.from!.id);
      await showTask(ctx, taskId);
    }
  });

  // Skip description for tasks
  bot.action(/^skd_([a-f0-9]{24})$/, async (ctx: Context) => {
    const state = inputState.get(ctx.from!.id);
    if (!state || state.step !== "description") return;
    state.description = "";
    state.step = "attachments";
    const finishId =
      state.mode === "add_task" ? state.subjectId : state.taskId;
    await editOrSend(ctx, '📎 Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---', Markup.inlineKeyboard([
            [Markup.button.callback("✅ Готово", `fta_${finishId}`)],
          ]) as any);
  });
}

export default tasksHandler;
export { showTask, taskEditMenu };
