import { Telegraf, Context, Markup } from "telegraf";
import { isStudent, isSuperadmin } from "../middleware/auth";
import { editOrSend, newScreen, trackSend, isPrivate, notice } from "../helpers/editOrSend";
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
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {
    const msg = (e as Error).message || "";
    console.error("[attachments] swap failed:", msg);
    // file_id належить конкретному боту: на стенді файли бойового бота не відкрити
    const alien = /wrong file identifier|wrong remote file|MEDIA_EMPTY/i.test(msg);
    await ctx
      .answerCbQuery(
        alien ? "Файл завантажений іншим ботом - тут він недоступний" : "Не вдалося відкрити файл",
        { show_alert: true }
      )
      .catch(() => {});
  }
}

/**
 * Кнопки гортання вкладень. Лічильник посередині перемикає вигляд: по одному
 * файлу в цьому ж вікні або всі одразу списком.
 */
function attachmentKeyboard(taskId: string, idx: number, total: number) {
  const rows: any[] = [];
  if (total > 1) {
    const prev = (idx - 1 + total) % total;
    const next = (idx + 1) % total;
    rows.push([
      Markup.button.callback("◀️", `att_${taskId}_${prev}`),
      Markup.button.callback(`${idx + 1}/${total} · списком`, `attlist_${taskId}`),
      Markup.button.callback("▶️", `att_${taskId}_${next}`),
    ]);
  }
  rows.push([Markup.button.callback("⬅️ До завдання", `attback_${taskId}`)]);
  return Markup.inlineKeyboard(rows);
}

/**
 * Показані списком повідомлення. Тримаємо їхні id, щоб «згорнути» прибрало
 * саме їх: альбом у Telegram це кілька повідомлень, редагуванням його не забрати.
 */
interface ListedState {
  /** Альбоми і текстові відповіді - усе, що показали списком. */
  media: number[];
  /** Колишнє вікно: воно стало першим файлом списку. */
  window: number;
}

const listed = new Map<string, ListedState>();

function listedKey(ctx: Context, id: string): string {
  return `${ctx.chat!.id}:${id}`;
}

export interface FileItem {
  type: "photo" | "document";
  file_id: string;
}

/** Альбом не змішує документи з фото і бере не більше десяти за раз. */
function albums(items: FileItem[]): { type: string; media: string }[][] {
  const out: { type: string; media: string }[][] = [];
  for (const kind of ["photo", "document"] as const) {
    const same = items.filter((a) => a.type === kind).map((a) => ({ type: kind, media: a.file_id }));
    for (let i = 0; i < same.length; i += 10) out.push(same.slice(i, i + 10));
  }
  return out;
}

/**
 * Показуємо всі файли списком.
 *
 * Поточне вікно стає першим файлом і лишається без кнопок, решта йде
 * альбомами під ним, а кнопки переїжджають у нове повідомлення - воно завжди
 * останнє. Так керування не губиться серед файлів, скільки б їх не було.
 */
async function showFileList(
  ctx: Context,
  key: string,
  items: FileItem[],
  texts: string[],
  caption: string,
  keyboard: any,
  image?: { render: () => Promise<Buffer> }
): Promise<number> {
  const chatId = ctx.chat!.id;
  const windowId = (ctx.update as any).callback_query?.message?.message_id as number;
  const shown: number[] = [];
  let rest = items;

  // Перший файл лишається у вже відкритому вікні, щоб не плодити повідомлення
  if (windowId && items.length) {
    try {
      await ctx.telegram.editMessageMedia(chatId, windowId, undefined, {
        type: items[0].type,
        media: items[0].file_id,
      } as any);
      rest = items.slice(1);
    } catch (e) {
      console.error("[list] перший файл не став у вікно:", (e as Error).message);
    }
  }

  for (const group of albums(rest)) {
    try {
      const sent = await ctx.telegram.sendMediaGroup(chatId, group as any, {
        disable_notification: true,
      } as any);
      shown.push(...sent.map((m: any) => m.message_id));
    } catch (e) {
      console.error("[list] альбом не пішов:", (e as Error).message);
    }
  }

  for (const t of texts) {
    const m = await ctx.telegram
      .sendMessage(chatId, t, { disable_notification: true })
      .catch(() => null);
    if (m) shown.push(m.message_id);
  }

  listed.set(key, { media: shown, window: windowId });
  await newScreen(ctx, caption, keyboard, image);
  return shown.length + (rest.length < items.length ? 1 : 0);
}

/** Прибираємо показаний список: і альбоми, і колишнє вікно. */
async function clearFileList(ctx: Context, key: string): Promise<void> {
  const st = listed.get(key);
  if (!st) return;
  listed.delete(key);
  for (const id of [...st.media, st.window]) {
    if (id) await ctx.telegram.deleteMessage(ctx.chat!.id, id).catch(() => {});
  }
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
  // Відмітка «здано» - особистий облік суперадміна, решті її не показуємо.
  if (await isSuperadmin(ctx)) {
    actions.push(Markup.button.callback((task as any).done ? "✅" : "⬜", `tdone_${taskId}`));
  }
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
  const head = `${task.done ? "✅ " : ""}${task.emoji || "📌"} <b>${escapeHtml(task.title)}</b>`;
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

/** Один файл у поточному вікні: індекс закільцьовуємо. */
async function showAttachment(ctx: Context, taskId: string, idx: number): Promise<void> {
  const { task } = await subjectService.getTask(taskId);
  if (!task?.attachments?.length) return;
  const total = task.attachments.length;
  const at = ((idx % total) + total) % total;
  const att = task.attachments[at];
  await swapMedia(
    ctx,
    { type: att.type === "photo" ? "photo" : "document", media: att.file_id },
    attachmentKeyboard(taskId, at, total)
  );
}

function tasksHandler(bot: Telegraf): void {
  // View task
  bot.action(/^task_([a-f0-9]{24})$/, async (ctx: Context) => {
    await showTask(ctx, (ctx as any).match![1]);
  });

  bot.action(/^tdone_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("Тільки для суперадміна.", { show_alert: true });
    }
    const taskId = (ctx as any).match![1];
    const { task } = await subjectService.getTask(taskId);
    if (!task) return ctx.answerCbQuery("Завдання не знайдено.");
    const done = !(task as any).done;
    await subjectService.updateTask(taskId, { done, doneAt: done ? new Date() : null } as any);
    await ctx.answerCbQuery(done ? "Здано" : "Знято відмітку");
    await showTask(ctx, taskId);
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
    await showAttachment(ctx, (ctx as any).match![1], 0);
  });

  bot.action(/^att_([a-f0-9]{24})_(\d+)$/, async (ctx: Context) => {
    const m = (ctx as any).match as RegExpMatchArray;
    await showAttachment(ctx, m[1], Number(m[2]));
  });

  // Усі вкладення одразу: файли лишаються списком, кнопки - в останньому
  // повідомленні, щоб керування не загубилось між ними.
  bot.action(/^attlist_([a-f0-9]{24})$/, async (ctx: Context) => {
    const taskId = (ctx as any).match![1];
    const { subject, task } = await subjectService.getTask(taskId);
    if (!task?.attachments?.length) return ctx.answerCbQuery("Немає вкладень.");
    await clearFileList(ctx, listedKey(ctx, taskId));

    const items: FileItem[] = task.attachments.map((a: any) => ({
      type: a.type === "photo" ? "photo" : "document",
      file_id: a.file_id,
    }));
    const shown = await showFileList(
      ctx,
      listedKey(ctx, taskId),
      items,
      [],
      `📎 <b>${escapeHtml(task.title)}</b>\nФайлів: ${items.length} - показані вище.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔽 Згорнути список", `attfold_${taskId}`)],
        [Markup.button.callback("⬅️ До завдання", `attback_${taskId}`)],
      ]),
      { render: () => renderTaskCard(subject!.name, task) }
    );
    if (!shown) return ctx.answerCbQuery("Не вдалося показати файли.", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
  });

  // Згортання: список прибираємо, а повідомлення з кнопками стає вікном гортання
  bot.action(/^attfold_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    const taskId = (ctx as any).match![1];
    await clearFileList(ctx, listedKey(ctx, taskId));
    await showAttachment(ctx, taskId, 0);
  });

  // Повернення до завдання: повідомлення з файлом текстом не стає, тому
  // прибираємо його і малюємо картку заново.
  bot.action(/^attback_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    const taskId = (ctx as any).match![1];
    await clearFileList(ctx, listedKey(ctx, taskId));
    await showTask(ctx, taskId);
  });

  // Show answers
  // Відповіді показуємо тим самим списком: файли вище, кнопки останнім
  // повідомленням. Текстові відповіді йдуть окремими повідомленнями поруч.
  bot.action(/^sa_([a-f0-9]{24})$/, async (ctx: Context) => {
    if (!(await isStudent(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    const taskId = (ctx as any).match![1];
    const { subject, task } = await subjectService.getTask(taskId);
    if (!task?.answers?.length) {
      return ctx.answerCbQuery("❌ Нет ответов.");
    }
    const key = listedKey(ctx, `ans_${taskId}`);
    await clearFileList(ctx, key);

    const items: FileItem[] = task.answers
      .filter((a: any) => a.type === "photo" || a.type === "document")
      .map((a: any) => ({ type: a.type, file_id: a.file_id }));
    const texts = task.answers.filter((a: any) => a.type === "text").map((a: any) => a.content);

    const shown = await showFileList(
      ctx,
      key,
      items,
      texts,
      `📖 <b>Відповіді</b>\n${escapeHtml(task.title)} - ${task.answers.length} шт., показані вище.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🔽 Згорнути", `safold_${taskId}`)],
        [Markup.button.callback("⬅️ До завдання", `saback_${taskId}`)],
      ]),
      { render: () => renderTaskCard(subject!.name, task) }
    );
    if (!shown) return ctx.answerCbQuery("Не вдалося показати відповіді.", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^(safold|saback)_([a-f0-9]{24})$/, async (ctx: Context) => {
    await ctx.answerCbQuery().catch(() => {});
    const taskId = (ctx as any).match![2];
    await clearFileList(ctx, listedKey(ctx, `ans_${taskId}`));
    await showTask(ctx, taskId);
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
