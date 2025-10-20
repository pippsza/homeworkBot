const { Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_PATH = path.join(__dirname, "../data.json");
const ATTACHMENTS_DIR = path.join(__dirname, "../attachments");
const DEFAULT_USERS = {
  ADMINS: ["@pippsza"],
  ANSWER_VIEWERS: ["@pippsza"],
  SUPERUSERS: ["@pippsza"],
};

function loadData() {
  if (fs.existsSync(DATA_PATH)) {
    try {
      const json = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
      if (!json.users) json.users = DEFAULT_USERS;
      if (!json.subjects) json.subjects = [];
      if (!json.infos) json.infos = [];
      if (!json.chatMessages) json.chatMessages = {};
      // Migrate emoji if old structure
      if (json.subjectEmojis) {
        json.subjects.forEach((s) => {
          if (!s.emoji) s.emoji = json.subjectEmojis[s.name] || "📚";
        });
        delete json.subjectEmojis;
      }
      json.subjects.forEach((s) => {
        if (!s.lecturerName) s.lecturerName = "";
        if (!s.lecturerContact) s.lecturerContact = "";
        if (!s.practitionerName) s.practitionerName = "";
        if (!s.practitionerContact) s.practitionerContact = "";
        s.tasks.forEach((t) => {
          if (!Array.isArray(t.attachments)) t.attachments = [];
          if (!Array.isArray(t.answers)) t.answers = [];
          // If old structure (just strings), assume type based on common practice or set to 'document'
          if (
            t.attachments.length > 0 &&
            typeof t.attachments[0] === "string"
          ) {
            t.attachments = t.attachments.map((file_id) => ({
              type: "document",
              file_id,
            })); // or 'photo' if assuming photos
          }
        });
      });
      json.infos.forEach((info) => {
        if (!info.emoji) info.emoji = "ℹ️";
        if (!info.description) info.description = "";
        if (!Array.isArray(info.attachments)) info.attachments = [];
        if (
          info.attachments.length > 0 &&
          typeof info.attachments[0] === "string"
        ) {
          info.attachments = info.attachments.map((file_id) => ({
            type: "document",
            file_id,
          }));
        }
      });
      return json;
    } catch (e) {
      console.error("[loadData] parse error, returning defaults", e);
      return {
        users: DEFAULT_USERS,
        subjects: [],
        infos: [],
        chatMessages: {},
      };
    }
  }
  return {
    users: DEFAULT_USERS,
    subjects: [],
    infos: [],
    chatMessages: {},
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    console.log("[saveData] Данные успешно сохранены to", DATA_PATH);
  } catch (e) {
    console.error("[saveData] Ошибка при сохранении данных", e);
  }
}

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download: ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function saveAttachment(ctx, file_id, type) {
  try {
    const file = await ctx.telegram.getFile(file_id);
    const url = await ctx.telegram.getFileLink(file_id);
    const buffer = await downloadFile(url);
    const ext =
      path.extname(file.file_path) || (type === "photo" ? ".jpg" : "");
    const filePath = path.join(ATTACHMENTS_DIR, `${file_id}${ext}`);
    fs.writeFileSync(filePath, buffer);
    console.log(`[saveAttachment] Saved ${type} to ${filePath}`);
    return filePath;
  } catch (e) {
    console.error("[saveAttachment error]", e);
    return null;
  }
}

function deleteAttachment(local_path) {
  if (local_path && fs.existsSync(local_path)) {
    fs.unlinkSync(local_path);
    console.log(`[deleteAttachment] Deleted file: ${local_path}`);
  }
}

function deleteAllAttachments() {
  if (fs.existsSync(ATTACHMENTS_DIR)) {
    fs.readdirSync(ATTACHMENTS_DIR).forEach((file) => {
      const filePath = path.join(ATTACHMENTS_DIR, file);
      fs.unlinkSync(filePath);
      console.log(`[deleteAllAttachments] Deleted file: ${filePath}`);
    });
  }
}

const data = loadData();

function isAdmin(ctx) {
  return (
    ctx.from &&
    Array.isArray(data.users?.ADMINS) &&
    (data.users.ADMINS.includes(`@${ctx.from.username}`) ||
      (Array.isArray(data.users?.SUPERUSERS) &&
        data.users.SUPERUSERS.includes(`@${ctx.from.username}`)))
  );
}

function isAnswerViewer(ctx) {
  return (
    ctx.from &&
    Array.isArray(data.users?.ANSWER_VIEWERS) &&
    (data.users.ANSWER_VIEWERS.includes(`@${ctx.from.username}`) ||
      (Array.isArray(data.users?.SUPERUSERS) &&
        data.users.SUPERUSERS.includes(`@${ctx.from.username}`)))
  );
}

function isSuperuser(ctx) {
  return (
    ctx.from &&
    Array.isArray(data.users?.SUPERUSERS) &&
    data.users.SUPERUSERS.includes(`@${ctx.from.username}`)
  );
}

function isPrivate(ctx) {
  return ctx.chat && ctx.chat.type === "private";
}

const replyKeyboard = Markup.keyboard([["🏠 Главное меню"]])
  .resize()
  .persistent();

async function mainMenu(ctx) {
  const buttons = [
    [Markup.button.callback("📚 Предметы", "subjects")],
    [Markup.button.callback("ℹ️ Информация", "infos")],
  ];
  if (isAdmin(ctx)) {
    buttons.push([
      Markup.button.callback("⚙️ Настройки", "settings"),
      Markup.button.callback("🛠 Инструменты", "tools"),
    ]);
  } else {
    buttons.push([Markup.button.callback("⚙️ Настройки", "settings")]);
  }
  try {
    return await trackSend(ctx, () =>
      ctx.reply("🏠 Главное меню\n\nВыберите опцию ниже:", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons),
        disable_notification: !isPrivate(ctx),
      })
    );
  } catch (e) {
    console.error("[mainMenu error]", e);
  }
}

let interactiveMessageId = {};

function saveInteractiveMessageId(ctx) {
  if (ctx.chat && ctx.from && ctx.update && ctx.update.callback_query) {
    interactiveMessageId[ctx.chat.id] =
      ctx.update.callback_query.message.message_id;
  }
}

async function editOrSend(ctx, text, keyboard) {
  saveInteractiveMessageId(ctx);
  const msgId = interactiveMessageId[ctx.chat.id];
  try {
    if (ctx.update.callback_query && msgId) {
      await ctx.telegram.editMessageText(ctx.chat.id, msgId, undefined, text, {
        parse_mode: "HTML",
        reply_markup: keyboard?.reply_markup,
      });
    } else {
      const sent = await trackSend(ctx, () =>
        ctx.reply(text, {
          ...keyboard,
          parse_mode: "HTML",
          disable_notification: !isPrivate(ctx),
        })
      );
      interactiveMessageId[ctx.chat.id] = sent.message_id;
    }
  } catch (e) {
    if (
      e.response &&
      e.response.error_code === 400 &&
      e.response.description.includes("message is not modified")
    ) {
      // Игнорируем ошибку, если сообщение не изменилось
      return;
    }
    console.error("[editOrSend error]", e);
    if (e.response && e.response.error_code === 429) {
      const retryAfter = e.response.parameters.retry_after;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      // Повторить запрос
      await editOrSend(ctx, text, keyboard);
    } else {
      const sent = await trackSend(ctx, () =>
        ctx.reply(text, {
          ...keyboard,
          parse_mode: "HTML",
          disable_notification: !isPrivate(ctx),
        })
      );
      interactiveMessageId[ctx.chat.id] = sent.message_id;
    }
  }
}

async function trackSend(ctx, sendFunc) {
  const sent = await sendFunc();
  const chatId = ctx.chat.id;
  if (!data.chatMessages[chatId]) data.chatMessages[chatId] = [];
  data.chatMessages[chatId].push(sent.message_id);
  saveData(data);
  return sent;
}

const inputState = {};

function subjectsHandler(bot) {
  bot.start(async (ctx) => {
    try {
      await mainMenu(ctx);
      await trackSend(ctx, () =>
        ctx.reply("Или используйте кнопку ниже для возврата в меню:", {
          ...replyKeyboard,
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[start error]", e);
    }
  });

  bot.action("main_menu", async (ctx) => {
    try {
      await mainMenu(ctx);
    } catch (e) {
      console.error("[main_menu error]", e);
    }
  });

  // Вывод списка предметов
  bot.action("subjects", async (ctx) => {
    console.log(
      "[ACTION] subjects by",
      ctx.from && ctx.from.username,
      "subjectsLen=",
      data.subjects.length
    );
    if (data.subjects.length === 0) {
      const buttons = [];
      if (isAdmin(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить предмет", "add_subject"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
      try {
        await editOrSend(
          ctx,
          "😔 Нет предметов в списке.\n\n---",
          Markup.inlineKeyboard(buttons)
        );
      } catch (e) {
        console.error("[subjects error]", e);
      }
      return;
    }
    let msg = "📋 Список предметов:\n\n";
    data.subjects.forEach((s, i) => {
      const emoji = s.emoji || "📚";
      msg += `${emoji} ${s.name}\n`;
    });
    msg += "\n---";
    const subjectButtons = [];
    for (let i = 0; i < data.subjects.length; i += 3) {
      subjectButtons.push(
        data.subjects
          .slice(i, i + 3)
          .map((s, j) =>
            Markup.button.callback(s.emoji || "📚", `subject_${i + j}`)
          )
      );
    }
    const buttons = [...subjectButtons];
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[subjects error]", e);
    }
  });

  bot.action(/^subject_(\d+)$/, async (ctx) => {
    console.log(
      "[ACTION] subject by",
      ctx.from && ctx.from.username,
      "match=",
      ctx.match
    );
    const idx = Number(ctx.match[1]);
    const subject = data.subjects[idx];
    if (!subject)
      return editOrSend(
        ctx,
        "❌ Предмет не найден.\n\n---",
        Markup.inlineKeyboard([
          [Markup.button.callback("⬅️ Назад", "subjects")],
        ])
      );
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
      subject.tasks.forEach((t, i) => {
        msg += `${t.emoji || "📄"} ${t.title}\n`;
      });
    }
    msg += "\n---";
    const taskButtons = [];
    for (let j = 0; j < subject.tasks.length; j += 3) {
      taskButtons.push(
        subject.tasks
          .slice(j, j + 3)
          .map((t, k) =>
            Markup.button.callback(t.emoji || "📄", `task_${idx}_${j + k}`)
          )
      );
    }
    let buttons = [...taskButtons];
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить задание", `add_task_${idx}`),
      ]);
      buttons.push([
        Markup.button.callback("✏️ Редактировать", `edit_subject_menu_${idx}`),
      ]);
      buttons.push([
        Markup.button.callback(
          "🗑️ Удалить предмет",
          `subjects_remove_confirm_${idx}`
        ),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "subjects")]);
    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[subject error]", e);
    }
  });

  bot.action(/^subjects_remove_confirm_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    try {
      await editOrSend(
        ctx,
        `⚠️ Вы уверены, что хотите удалить предмет?\n\nЭто действие необратимо!\n\n---`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Да, удалить",
              `subjects_remove_yes_${idx}`
            ),
          ],
          [Markup.button.callback("❌ Нет, отменить", `subject_${idx}`)],
        ])
      );
    } catch (e) {
      console.error("[subjects_remove_confirm error]", e);
    }
  });

  bot.action(/^subjects_remove_yes_(\d+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx))
        return await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      const idx = Number(ctx.match[1]);
      console.log(
        "[delete_subject] invoked by",
        ctx.from && ctx.from.username,
        "idx=",
        idx,
        "subjectsLen=",
        data.subjects.length
      );

      if (Number.isNaN(idx) || idx < 0 || idx >= data.subjects.length) {
        await ctx.answerCbQuery("❌ Предмет не найден.", { show_alert: false });
        return;
      }

      // Delete all attachments in all tasks
      const subject = data.subjects[idx];
      for (const task of subject.tasks) {
        for (const att of task.attachments || []) {
          deleteAttachment(att.local_path);
        }
        for (const ans of task.answers || []) {
          deleteAttachment(ans.local_path);
        }
      }

      const removed = data.subjects.splice(idx, 1)[0];
      saveData(data);
      console.log(`[LOG] ${ctx.from.username} удалил предмет: ${removed.name}`);

      await ctx.answerCbQuery("✅ Предмет удалён");

      const msg =
        data.subjects.length === 0
          ? "😔 Нет предметов."
          : "📋 Список предметов:\n\n" +
            data.subjects
              .map((s) => `${s.emoji || "📚"} ${s.name}`)
              .join("\n") +
            "\n\n---";

      const subjectButtons = [];
      for (let i = 0; i < data.subjects.length; i += 3) {
        subjectButtons.push(
          data.subjects
            .slice(i, i + 3)
            .map((s, j) =>
              Markup.button.callback(s.emoji || "📚", `subject_${i + j}`)
            )
        );
      }
      const buttons = [...subjectButtons];
      if (isAdmin(ctx))
        buttons.push([
          Markup.button.callback("➕ Добавить предмет", "add_subject"),
        ]);
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);

      await editOrSend(
        ctx,
        `🗑️ Предмет ${removed?.name || "?"} удалён.\n\n${msg}`,
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      console.error("[delete_subject error]", err);
      try {
        await ctx.answerCbQuery("❌ Ошибка при удалении", { show_alert: true });
      } catch (e) {}
    }
  });

  bot.action(/^task_(\d+)_(\d+)$/, async (ctx) => {
    await showTask(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
  });

  async function showTask(ctx, sIdx, tIdx) {
    console.log(
      "[SHOW_TASK] by",
      ctx.from && ctx.from.username,
      "sIdx=",
      sIdx,
      "tIdx=",
      tIdx
    );
    const subject = data.subjects[sIdx];
    const task = subject?.tasks[tIdx];
    if (!task) {
      try {
        return await editOrSend(
          ctx,
          "❌ Задание не найдено.\n\n---",
          Markup.inlineKeyboard([
            [Markup.button.callback("⬅️ Назад", `subject_${sIdx}`)],
          ])
        );
      } catch (e) {
        console.error("[showTask error]", e);
      }
      return;
    }
    let msg = `*📄 ${task.title}*\n\n`;
    if (task.description) msg += `${task.description}\n\n---\n`;
    let buttons = [];
    if (isAnswerViewer(ctx) && task.answers?.length) {
      buttons.push([
        Markup.button.callback(
          "📖 Показать ответы",
          `show_answers_${sIdx}_${tIdx}`
        ),
      ]);
    }
    if (task.attachments && task.attachments.length > 0) {
      buttons.push([
        Markup.button.callback(
          `📎 Вложения (${task.attachments.length})`,
          `show_attachments_${sIdx}_${tIdx}`
        ),
      ]);
    }
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback(
          "➕ Добавить ответ",
          `add_answer_${sIdx}_${tIdx}`
        ),
      ]);
      buttons.push([
        Markup.button.callback(
          "🗑️ Удалить задание",
          `tasks_remove_confirm_${sIdx}_${tIdx}`
        ),
      ]);
      buttons.push([
        Markup.button.callback(
          "✏️ Редактировать",
          `edit_task_menu_${sIdx}_${tIdx}`
        ),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", `subject_${sIdx}`)]);
    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[showTask error]", e);
    }
  }

  bot.action(/^tasks_remove_confirm_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    try {
      await editOrSend(
        ctx,
        `⚠️ Вы уверены, что хотите удалить задание?\n\nЭто действие необратимо!\n\n---`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Да, удалить",
              `tasks_remove_yes_${sIdx}_${tIdx}`
            ),
          ],
          [Markup.button.callback("❌ Нет, отменить", `task_${sIdx}_${tIdx}`)],
        ])
      );
    } catch (e) {
      console.error("[tasks_remove_confirm error]", e);
    }
  });

  bot.action(/^tasks_remove_yes_(\d+)_(\d+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx))
        return await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      const sIdx = Number(ctx.match[1]);
      const tIdx = Number(ctx.match[2]);
      console.log(
        "[delete_task] invoked by",
        ctx.from && ctx.from.username,
        "sIdx=",
        sIdx,
        "tIdx=",
        tIdx
      );

      if (
        Number.isNaN(sIdx) ||
        Number.isNaN(tIdx) ||
        sIdx < 0 ||
        sIdx >= data.subjects.length ||
        !Array.isArray(data.subjects[sIdx].tasks) ||
        tIdx < 0 ||
        tIdx >= data.subjects[sIdx].tasks.length
      ) {
        await ctx.answerCbQuery("❌ Задание не найдено.", {
          show_alert: false,
        });
        return;
      }

      // Delete attachments files
      const task = data.subjects[sIdx].tasks[tIdx];
      for (const att of task.attachments || []) {
        deleteAttachment(att.local_path);
      }
      for (const ans of task.answers || []) {
        deleteAttachment(ans.local_path);
      }

      const taskTitle = data.subjects[sIdx].tasks.splice(tIdx, 1)[0]?.title;
      saveData(data);
      console.log(`[LOG] ${ctx.from.username} удалил задание: ${taskTitle}`);

      await ctx.answerCbQuery("✅ Задание удалено");

      const subject = data.subjects[sIdx];
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
        msg +=
          "📝 Задания:\n" +
          subject.tasks.map((t) => `${t.emoji || "📄"} ${t.title}`).join("\n") +
          "\n\n---";
      }

      const taskButtons = [];
      for (let j = 0; j < subject.tasks.length; j += 3) {
        taskButtons.push(
          subject.tasks
            .slice(j, j + 3)
            .map((t, k) =>
              Markup.button.callback(t.emoji || "📄", `task_${sIdx}_${j + k}`)
            )
        );
      }
      let buttons = [...taskButtons];
      if (isAdmin(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить задание", `add_task_${sIdx}`),
        ]);
        buttons.push([
          Markup.button.callback(
            "✏️ Редактировать",
            `edit_subject_menu_${sIdx}`
          ),
        ]);
        buttons.push([
          Markup.button.callback(
            "🗑️ Удалить предмет",
            `subjects_remove_confirm_${sIdx}`
          ),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "subjects")]);

      await editOrSend(
        ctx,
        `🗑️ Задание "${taskTitle}" удалено.\n\n${msg}`,
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      console.error("[delete_task error]", err);
      try {
        await ctx.answerCbQuery("❌ Ошибка при удалении", { show_alert: true });
      } catch (e) {}
    }
  });

  bot.action(/^show_attachments_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    const task = data.subjects[sIdx].tasks[tIdx];
    if (task.attachments && task.attachments.length > 0) {
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
    }
  });

  // Меню редактирования задачи
  bot.action(/^edit_task_menu_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    try {
      await editOrSend(
        ctx,
        `✏️ Что хотите изменить в задании?\n\n---`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "📝 Заголовок",
              `edit_task_title_${sIdx}_${tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "😀 Emoji",
              `edit_task_emoji_${sIdx}_${tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "📄 Описание",
              `edit_task_description_${sIdx}_${tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "📎 Вложения",
              `edit_task_attachments_${sIdx}_${tIdx}`
            ),
          ],
          [Markup.button.callback("✅ Готово", `task_${sIdx}_${tIdx}`)],
        ])
      );
    } catch (e) {
      console.error("[edit_task_menu error]", e);
    }
  });

  // Редактирование заголовка задачи
  bot.action(/^edit_task_title_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    inputState[ctx.from.id] = {
      mode: "edit_task",
      step: "edit_title",
      sIdx,
      tIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📝 Введите новый заголовок:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_task_title prompt error]", e);
    }
  });

  // Редактирование emoji задачи
  bot.action(/^edit_task_emoji_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    inputState[ctx.from.id] = {
      mode: "edit_task",
      step: "edit_emoji",
      sIdx,
      tIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("😀 Введите новый emoji:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_task_emoji prompt error]", e);
    }
  });

  // Редактирование описания задачи
  bot.action(/^edit_task_description_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    inputState[ctx.from.id] = {
      mode: "edit_task",
      step: "edit_description",
      sIdx,
      tIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📄 Введите новое описание:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_task_description prompt error]", e);
    }
  });

  // Редактирование вложений задачи
  bot.action(/^edit_task_attachments_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    inputState[ctx.from.id] = {
      mode: "edit_task",
      step: "attachments",
      sIdx,
      tIdx,
      attachments: [],
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          '📎 Отправьте новые файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---',
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "✅ Готово",
                  `finish_attachments_${sIdx}_${tIdx}`
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[edit_task_attachments prompt error]", e);
    }
  });

  // Меню редактирования предмета
  bot.action(/^edit_subject_menu_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    try {
      await editOrSend(
        ctx,
        `✏️ Что хотите изменить в предмете?\n\n---`,
        Markup.inlineKeyboard([
          [Markup.button.callback("📘 Название", `edit_subject_name_${sIdx}`)],
          [Markup.button.callback("😀 Emoji", `edit_subject_emoji_${sIdx}`)],
          [
            Markup.button.callback(
              "👨‍🏫 ФИО лектора",
              `edit_subject_lecturer_name_${sIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "📞 Контакты лектора",
              `edit_subject_lecturer_contact_${sIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "👩‍🏫 ФИО практики",
              `edit_subject_practitioner_name_${sIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "📞 Контакты практики",
              `edit_subject_practitioner_contact_${sIdx}`
            ),
          ],
          [Markup.button.callback("✅ Готово", `subject_${sIdx}`)],
        ])
      );
    } catch (e) {
      console.error("[edit_subject_menu error]", e);
    }
  });

  // Новый раздел: Информация
  bot.action("infos", async (ctx) => {
    console.log(
      "[ACTION] infos by",
      ctx.from && ctx.from.username,
      "infosLen=",
      data.infos.length
    );
    if (data.infos.length === 0) {
      const buttons = [];
      if (isAdmin(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить информацию", "add_info"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
      try {
        await editOrSend(
          ctx,
          "😔 Нет информации в списке.\n\n---",
          Markup.inlineKeyboard(buttons)
        );
      } catch (e) {
        console.error("[infos error]", e);
      }
      return;
    }
    let msg = "📋 Список информации:\n\n";
    data.infos.forEach((info, i) => {
      const emoji = info.emoji || "ℹ️";
      msg += `${emoji} ${info.title}\n`;
    });
    msg += "\n---";
    const infoButtons = [];
    for (let i = 0; i < data.infos.length; i += 3) {
      infoButtons.push(
        data.infos
          .slice(i, i + 3)
          .map((info, j) =>
            Markup.button.callback(info.emoji || "ℹ️", `info_${i + j}`)
          )
      );
    }
    const buttons = [...infoButtons];
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить информацию", "add_info"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);
    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[infos error]", e);
    }
  });

  bot.action(/^info_(\d+)$/, async (ctx) => {
    console.log(
      "[ACTION] info by",
      ctx.from && ctx.from.username,
      "match=",
      ctx.match
    );
    const idx = Number(ctx.match[1]);
    const info = data.infos[idx];
    if (!info)
      return editOrSend(
        ctx,
        "❌ Информация не найдена.\n\n---",
        Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", "infos")]])
      );
    let msg = `*ℹ️ ${info.title}*\n\n`;
    if (info.description) msg += `${info.description}\n\n---\n`;
    let buttons = [];
    if (info.attachments && info.attachments.length > 0) {
      buttons.push([
        Markup.button.callback(
          `📎 Вложения (${info.attachments.length})`,
          `show_info_attachments_${idx}`
        ),
      ]);
    }
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("✏️ Редактировать", `edit_info_menu_${idx}`),
      ]);
      buttons.push([
        Markup.button.callback("🗑️ Удалить", `infos_remove_confirm_${idx}`),
      ]);
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "infos")]);
    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[info error]", e);
    }
  });

  bot.action(/^infos_remove_confirm_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    try {
      await editOrSend(
        ctx,
        `⚠️ Вы уверены, что хотите удалить информацию?\n\nЭто действие необратимо!\n\n---`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Да, удалить", `infos_remove_yes_${idx}`)],
          [Markup.button.callback("❌ Нет, отменить", `info_${idx}`)],
        ])
      );
    } catch (e) {
      console.error("[infos_remove_confirm error]", e);
    }
  });

  bot.action(/^infos_remove_yes_(\d+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx))
        return await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      const idx = Number(ctx.match[1]);
      console.log(
        "[delete_info] invoked by",
        ctx.from && ctx.from.username,
        "idx=",
        idx,
        "infosLen=",
        data.infos.length
      );

      if (Number.isNaN(idx) || idx < 0 || idx >= data.infos.length) {
        await ctx.answerCbQuery("❌ Информация не найдена.", {
          show_alert: false,
        });
        return;
      }

      // Delete attachments files
      const info = data.infos[idx];
      for (const att of info.attachments || []) {
        deleteAttachment(att.local_path);
      }

      const removed = data.infos.splice(idx, 1)[0];
      saveData(data);
      console.log(
        `[LOG] ${ctx.from.username} удалил информацию: ${removed.title}`
      );

      await ctx.answerCbQuery("✅ Информация удалена");

      const msg =
        data.infos.length === 0
          ? "😔 Нет информации."
          : "📋 Список информации:\n\n" +
            data.infos
              .map((info) => `${info.emoji || "ℹ️"} ${info.title}`)
              .join("\n") +
            "\n\n---";

      const infoButtons = [];
      for (let i = 0; i < data.infos.length; i += 3) {
        infoButtons.push(
          data.infos
            .slice(i, i + 3)
            .map((info, j) =>
              Markup.button.callback(info.emoji || "ℹ️", `info_${i + j}`)
            )
        );
      }
      const buttons = [...infoButtons];
      if (isAdmin(ctx))
        buttons.push([
          Markup.button.callback("➕ Добавить информацию", "add_info"),
        ]);
      buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);

      await editOrSend(
        ctx,
        `🗑️ Информация "${removed?.title || "?"}" удалена.\n\n${msg}`,
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      console.error("[delete_info error]", err);
      try {
        await ctx.answerCbQuery("❌ Ошибка при удалении", { show_alert: true });
      } catch (e) {}
    }
  });

  bot.action(/^show_info_attachments_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const info = data.infos[idx];
    if (info.attachments && info.attachments.length > 0) {
      for (const att of info.attachments) {
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
    }
  });

  // Меню редактирования информации
  bot.action(/^edit_info_menu_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    try {
      await editOrSend(
        ctx,
        `✏️ Что хотите изменить в информации?\n\n---`,
        Markup.inlineKeyboard([
          [Markup.button.callback("📝 Заголовок", `edit_info_title_${idx}`)],
          [Markup.button.callback("😀 Emoji", `edit_info_emoji_${idx}`)],
          [
            Markup.button.callback(
              "📄 Описание",
              `edit_info_description_${idx}`
            ),
          ],
          [
            Markup.button.callback(
              "📎 Вложения",
              `edit_info_attachments_${idx}`
            ),
          ],
          [Markup.button.callback("✅ Готово", `info_${idx}`)],
        ])
      );
    } catch (e) {
      console.error("[edit_info_menu error]", e);
    }
  });

  // Добавление предмета
  bot.action("add_subject", async (ctx) => {
    if (!isAdmin(ctx)) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Нет прав.", { disable_notification: !isPrivate(ctx) })
        );
      } catch (e) {
        console.error("[add_subject error]", e);
      }
      return;
    }
    inputState[ctx.from.id] = {
      mode: "add_subject",
      step: "name",
      name: "",
      emoji: "",
      lecturerName: "",
      lecturerContact: "",
      practitionerName: "",
      practitionerContact: "",
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📘 Введите название нового предмета:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[add_subject error]", e);
    }
  });

  // Добавление информации
  bot.action("add_info", async (ctx) => {
    if (!isAdmin(ctx)) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Нет прав.", { disable_notification: !isPrivate(ctx) })
        );
      } catch (e) {
        console.error("[add_info error]", e);
      }
      return;
    }
    inputState[ctx.from.id] = {
      mode: "add_info",
      step: "title",
      title: "",
      emoji: "",
      description: "",
      attachments: [],
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("ℹ️ Введите заголовок информации:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[add_info error]", e);
    }
  });

  // Настройки
  bot.action("settings", async (ctx) => {
    let msg = "⚙️ Настройки\n\n";
    msg += "📋 Админы:\n" + (data.users.ADMINS.join("\n") || "Пусто") + "\n\n";
    msg +=
      "👀 Просмотрщики ответов:\n" +
      (data.users.ANSWER_VIEWERS.join("\n") || "Пусто") +
      "\n\n";
    msg +=
      "🔥 Суперпользователи:\n" +
      (data.users.SUPERUSERS.join("\n") || "Пусто") +
      "\n\n---";

    const buttons = [];
    if (isSuperuser(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить админа", "add_admin"),
        Markup.button.callback("➕ Добавить viewer", "add_answer_viewer"),
        Markup.button.callback("➕ Добавить superuser", "add_superuser"),
      ]);
      if (data.users.ADMINS.length > 0) {
        buttons.push(
          ...data.users.ADMINS.map((u) => [
            Markup.button.callback(
              `🗑 Удалить ${u}`,
              `remove_admin_${u.slice(1)}`
            ),
          ])
        );
      }
      if (data.users.ANSWER_VIEWERS.length > 0) {
        buttons.push(
          ...data.users.ANSWER_VIEWERS.map((u) => [
            Markup.button.callback(
              `🗑 Удалить ${u}`,
              `remove_viewer_${u.slice(1)}`
            ),
          ])
        );
      }
      if (data.users.SUPERUSERS.length > 0) {
        buttons.push(
          ...data.users.SUPERUSERS.map((u) => [
            Markup.button.callback(
              `🗑 Удалить ${u}`,
              `remove_superuser_${u.slice(1)}`
            ),
          ])
        );
      }
    }
    buttons.push([Markup.button.callback("⬅️ Назад", "main_menu")]);

    try {
      await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
    } catch (e) {
      console.error("[settings error]", e);
    }
  });

  // Добавление админа
  bot.action("add_admin", async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    inputState[ctx.from.id] = { mode: "add_user", step: "add_admin" };
    await trackSend(ctx, () =>
      ctx.reply("Введите username админа (с @):", {
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  // Добавление просмотрщика ответов
  bot.action("add_answer_viewer", async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    inputState[ctx.from.id] = { mode: "add_user", step: "add_answer_viewer" };
    await trackSend(ctx, () =>
      ctx.reply("Введите username просмотрщика (с @):", {
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  // Добавление суперпользователя
  bot.action("add_superuser", async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    inputState[ctx.from.id] = { mode: "add_user", step: "add_superuser" };
    await trackSend(ctx, () =>
      ctx.reply("Введите username суперпользователя (с @):", {
        disable_notification: !isPrivate(ctx),
      })
    );
  });

  // Удаление админа
  bot.action(/^remove_admin_(.+)$/, async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    const username = `@${ctx.match[1]}`;
    const index = data.users.ADMINS.indexOf(username);
    if (index > -1) {
      data.users.ADMINS.splice(index, 1);
      saveData(data);
      await ctx.answerCbQuery(`✅ ${username} удален из админов.`);
    } else {
      await ctx.answerCbQuery("❌ Пользователь не найден.");
    }
    // Обновить меню настроек
    await bot.action("settings", ctx);
  });

  // Удаление просмотрщика
  bot.action(/^remove_viewer_(.+)$/, async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    const username = `@${ctx.match[1]}`;
    const index = data.users.ANSWER_VIEWERS.indexOf(username);
    if (index > -1) {
      data.users.ANSWER_VIEWERS.splice(index, 1);
      saveData(data);
      await ctx.answerCbQuery(`✅ ${username} удален из просмотрщиков.`);
    } else {
      await ctx.answerCbQuery("❌ Пользователь не найден.");
    }
    // Обновить меню настроек
    await bot.action("settings", ctx);
  });

  // Удаление суперпользователя
  bot.action(/^remove_superuser_(.+)$/, async (ctx) => {
    if (!isSuperuser(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    const username = `@${ctx.match[1]}`;
    const index = data.users.SUPERUSERS.indexOf(username);
    if (index > -1) {
      data.users.SUPERUSERS.splice(index, 1);
      saveData(data);
      await ctx.answerCbQuery(`✅ ${username} удален из суперпользователей.`);
    } else {
      await ctx.answerCbQuery("❌ Пользователь не найден.");
    }
    // Обновить меню настроек
    await bot.action("settings", ctx);
  });

  // Добавление задания
  bot.action(/^add_task_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Нет прав.", { disable_notification: !isPrivate(ctx) })
        );
      } catch (e) {
        console.error("[add_task error]", e);
      }
      return;
    }
    const sIdx = Number(ctx.match[1]);
    console.log(
      "[ACTION] add_task by",
      ctx.from && ctx.from.username,
      "sIdx=",
      sIdx
    );
    inputState[ctx.from.id] = {
      mode: "add_task",
      step: "title",
      sIdx,
      title: "",
      description: "",
      attachments: [],
      emoji: "",
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📝 Введите заголовок задания:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[add_task prompt error]", e);
    }
  });

  // Добавление ответа к задаче
  bot.action(/^add_answer_(\d+)_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    const task = data.subjects[sIdx]?.tasks[tIdx];
    if (!task) {
      await ctx.answerCbQuery("❌ Задача не найдена.");
      return;
    }
    inputState[ctx.from.id] = {
      mode: "add_answer",
      step: "answer",
      sIdx,
      tIdx,
      answers: [], // Временный массив для новых ответов
    };
    try {
      await editOrSend(
        ctx,
        "➕ Добавьте ответ(ы) к задаче.\n\nМожете отправить текст, фото или документы. Когда закончите, нажмите '✅ Готово'.\n\n---",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Готово",
              `finish_answer_${sIdx}_${tIdx}`
            ),
          ],
          [Markup.button.callback("❌ Отмена", `task_${sIdx}_${tIdx}`)],
        ])
      );
    } catch (e) {
      console.error("[add_answer prompt error]", e);
    }
  });

  // Завершение добавления ответов
  bot.action(/^finish_answer_(\d+)_(\d+)$/, async (ctx) => {
    const state = inputState[ctx.from.id];
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    if (
      !state ||
      state.sIdx !== sIdx ||
      state.tIdx !== tIdx ||
      state.mode !== "add_answer"
    ) {
      await ctx.answerCbQuery("❌ Ошибка состояния.");
      return;
    }
    if (state.answers.length === 0) {
      await ctx.answerCbQuery("❌ Нет добавленных ответов.");
      return;
    }
    // Добавляем новые ответы к существующим (если есть)
    const task = data.subjects[sIdx].tasks[tIdx];
    if (!Array.isArray(task.answers)) task.answers = [];
    task.answers.push(...state.answers);
    saveData(data);
    delete inputState[ctx.from.id];
    await ctx.answerCbQuery("✅ Ответ(ы) добавлены.");
    // Показать задачу заново
    await showTask(ctx, sIdx, tIdx);
  });

  // Показать ответы
  bot.action(/^show_answers_(\d+)_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    const task = data.subjects[sIdx]?.tasks[tIdx];
    if (!task || !task.answers?.length) {
      await ctx.answerCbQuery("❌ Нет ответов.");
      return;
    }
    // Отправляем ответы
    for (const ans of task.answers) {
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

  bot.on("text", async (ctx) => {
    if (ctx.message.text === "/start") {
      delete inputState[ctx.from.id];
      try {
        await mainMenu(ctx);
      } catch (e) {
        console.error("[/start error]", e);
      }
      return;
    }

    if (ctx.message.text === "🏠 Главное меню") {
      delete inputState[ctx.from.id];
      try {
        await mainMenu(ctx);
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
      } catch (e) {
        console.error("[main_menu keyboard error]", e);
      }
      return;
    }

    const state = inputState[ctx.from.id];
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;

    if (!state) return;

    const text = ctx.message.text.trim();

    // Обработка добавления пользователей в настройки
    if (state.mode === "add_user") {
      const username = text;
      if (!username.startsWith("@")) {
        try {
          await trackSend(ctx, () =>
            ctx.reply("❌ Введите username с @", {
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_user error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      let list;
      let logMsg;
      if (state.step === "add_admin") {
        list = data.users.ADMINS;
        logMsg = "админ";
      } else if (state.step === "add_answer_viewer") {
        list = data.users.ANSWER_VIEWERS;
        logMsg = "просмотрщик ответов";
      } else if (state.step === "add_superuser") {
        list = data.users.SUPERUSERS;
        logMsg = "суперпользователь";
      }
      if (list.includes(username)) {
        try {
          await trackSend(ctx, () =>
            ctx.reply(`❌ Уже есть такой ${logMsg}.`, {
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_user error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      list.push(username);
      saveData(data);
      delete inputState[ctx.from.id];
      try {
        await trackSend(ctx, () =>
          ctx.reply(
            `✅ ${logMsg.charAt(0).toUpperCase() + logMsg.slice(1)} добавлен.`,
            { disable_notification: !isPrivate(ctx) }
          )
        );
        // Вернуться в настройки
        await bot.action("settings", ctx);
      } catch (e) {
        console.error("[add_user finish error]", e);
      }
      await ctx
        .deleteMessage(ctx.message.message_id)
        .catch((e) => console.error("Delete user msg error", e));
      return;
    }

    // Edit subject fields (separate handling)
    if (state.mode === "edit_subject") {
      if (state.step === "name") {
        if (!text) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Название не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[edit_subject name error]", e);
          }
          return;
        }
        data.subjects[state.sIdx].name = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Название обновлено!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          // Show edit menu again
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject name error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "emoji") {
        data.subjects[state.sIdx].emoji = text || "📚";
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Emoji обновлён!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject emoji error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "lecturer_name") {
        data.subjects[state.sIdx].lecturerName = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ ФИО лектора обновлено!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject lecturer_name error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "lecturer_contact") {
        data.subjects[state.sIdx].lecturerContact = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Контакты лектора обновлены!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject lecturer_contact error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "practitioner_name") {
        data.subjects[state.sIdx].practitionerName = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ ФИО практики обновлено!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject practitioner_name error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "practitioner_contact") {
        data.subjects[state.sIdx].practitionerContact = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Контакты практики обновлены!", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в предмете?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📘 Название",
                  `edit_subject_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_subject_emoji_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👨‍🏫 ФИО лектора",
                  `edit_subject_lecturer_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты лектора",
                  `edit_subject_lecturer_contact_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "👩‍🏫 ФИО практики",
                  `edit_subject_practitioner_name_${state.sIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📞 Контакты практики",
                  `edit_subject_practitioner_contact_${state.sIdx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `subject_${state.sIdx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_subject practitioner_contact error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
    }

    // Добавление/редактирование предмета
    if (state.mode === "add_subject" || state.mode === "edit_subject") {
      const isAdd = state.mode === "add_subject";
      if (state.step === "name") {
        const name = text;
        if (!name) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Название не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[add_subject name error]", e);
          }
          return;
        }
        state.name = name;
        state.step = "emoji";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              "😀 Введите смайлик для предмета (например, 📐) или пропустите:",
              { disable_notification: !isPrivate(ctx) }
            )
          );
        } catch (e) {
          console.error("[add_subject emoji prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "📚";
        state.step = "lecturer_name";
        try {
          await trackSend(ctx, () =>
            ctx.reply("👨‍🏫 Введите ФИО лектора (или пропустите):", {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "Пропустить",
                    isAdd
                      ? "skip_lecturer_name"
                      : `skip_lecturer_name_${state.sIdx}`
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_subject lecturer_name prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "lecturer_name") {
        state.lecturerName = text;
        state.step = "lecturer_contact";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              "📞 Введите контакты лектора (соц. сети, почта и т.д.) (или пропустите):",
              {
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      "Пропустить",
                      isAdd
                        ? "skip_lecturer_contact"
                        : `skip_lecturer_contact_${state.sIdx}`
                    ),
                  ],
                ]),
                disable_notification: !isPrivate(ctx),
              }
            )
          );
        } catch (e) {
          console.error("[add_subject lecturer_contact prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "lecturer_contact") {
        state.lecturerContact = text;
        state.step = "practitioner_name";
        try {
          await trackSend(ctx, () =>
            ctx.reply("👩‍🏫 Введите ФИО практики (или пропустите):", {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "Пропустить",
                    isAdd
                      ? "skip_practitioner_name"
                      : `skip_practitioner_name_${state.sIdx}`
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_subject practitioner_name prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "practitioner_name") {
        state.practitionerName = text;
        state.step = "practitioner_contact";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              "📞 Введите контакты практики (соц. сети, почта и т.д.) (или пропустите):",
              {
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      "Пропустить",
                      isAdd
                        ? "skip_practitioner_contact"
                        : `skip_practitioner_contact_${state.sIdx}`
                    ),
                  ],
                ]),
                disable_notification: !isPrivate(ctx),
              }
            )
          );
        } catch (e) {
          console.error("[add_subject practitioner_contact prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "practitioner_contact") {
        state.practitionerContact = text;
        if (isAdd) {
          data.subjects.push({
            name: state.name,
            emoji: state.emoji,
            lecturerName: state.lecturerName,
            lecturerContact: state.lecturerContact,
            practitionerName: state.practitionerName,
            practitionerContact: state.practitionerContact,
            tasks: [],
          });
        } else {
          const subject = data.subjects[state.sIdx];
          subject.name = state.name;
          subject.emoji = state.emoji;
          subject.lecturerName = state.lecturerName;
          subject.lecturerContact = state.lecturerContact;
          subject.practitionerName = state.practitionerName;
          subject.practitionerContact = state.practitionerContact;
        }
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Предмет сохранён!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await mainMenu(ctx);
        } catch (e) {
          console.error("[add_subject finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
    }

    // Добавление/редактирование информации
    if (state.mode === "add_info" || state.mode === "edit_info") {
      const isAdd = state.mode === "add_info";
      if (state.step === "title") {
        const title = text;
        if (!title) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Заголовок не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[add_info title error]", e);
          }
          return;
        }
        state.title = title;
        state.step = "emoji";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              "😀 Введите смайлик для информации (например, ℹ️) или пропустите:",
              { disable_notification: !isPrivate(ctx) }
            )
          );
        } catch (e) {
          console.error("[add_info emoji prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "ℹ️";
        state.step = "description";
        try {
          await trackSend(ctx, () =>
            ctx.reply("📄 Введите описание (или пропустите):", {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "Пропустить",
                    isAdd
                      ? "skip_info_description"
                      : `skip_info_description_${state.idx}`
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_info description prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "description") {
        state.description = text;
        state.step = "attachments";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              '📎 Отправьте файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---',
              {
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      "✅ Готово",
                      isAdd
                        ? "finish_info_attachments"
                        : `finish_info_attachments_${state.idx}`
                    ),
                  ],
                ]),
                disable_notification: !isPrivate(ctx),
              }
            )
          );
        } catch (e) {
          console.error("[add_info attachments prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_title") {
        const title = text;
        if (!title) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Заголовок не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[edit_info title error]", e);
          }
          return;
        }
        data.infos[state.idx].title = title;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Заголовок обновлён!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в информации?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_info_title_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_info_emoji_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_info_description_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_info_attachments_${state.idx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `info_${state.idx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_info title finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_emoji") {
        data.infos[state.idx].emoji = text || "ℹ️";
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Emoji обновлён!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в информации?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_info_title_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_info_emoji_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_info_description_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_info_attachments_${state.idx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `info_${state.idx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_info emoji finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_description") {
        data.infos[state.idx].description = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Описание обновлено!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в информации?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_info_title_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_info_emoji_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_info_description_${state.idx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_info_attachments_${state.idx}`
                ),
              ],
              [Markup.button.callback("✅ Готово", `info_${state.idx}`)],
            ])
          );
        } catch (e) {
          console.error("[edit_info description finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
    }

    // Добавление/редактирование задания
    if (state && (state.mode === "add_task" || state.mode === "edit_task")) {
      const isAdd = state.mode === "add_task";
      if (state.step === "title") {
        const title = text;
        if (!title) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Заголовок не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[add_task title error]", e);
          }
          await ctx
            .deleteMessage(ctx.message.message_id)
            .catch((e) => console.error("Delete user msg error", e));
          return;
        }
        state.title = title;
        state.step = "emoji";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              "😀 Введите смайлик для задания (например, 📄) или пропустите:",
              { disable_notification: !isPrivate(ctx) }
            )
          );
        } catch (e) {
          console.error("[add_task emoji prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "📄";
        state.step = "description";
        try {
          await trackSend(ctx, () =>
            ctx.reply("📄 Введите описание (или пропустите):", {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "Пропустить",
                    isAdd
                      ? `skip_description_${state.sIdx}`
                      : `skip_description_${state.sIdx}_${state.tIdx}`
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_task description prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "description") {
        state.description = text;
        state.step = "attachments";
        try {
          await trackSend(ctx, () =>
            ctx.reply(
              '📎 Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---',
              {
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback(
                      "✅ Готово",
                      isAdd
                        ? `finish_attachments_${state.sIdx}`
                        : `finish_attachments_${state.sIdx}_${state.tIdx}`
                    ),
                  ],
                ]),
                disable_notification: !isPrivate(ctx),
              }
            )
          );
        } catch (e) {
          console.error("[add_task attachments prompt error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_title") {
        const title = text;
        if (!title) {
          try {
            await trackSend(ctx, () =>
              ctx.reply("❌ Заголовок не может быть пустым.", {
                disable_notification: !isPrivate(ctx),
              })
            );
          } catch (e) {
            console.error("[edit_task title error]", e);
          }
          await ctx
            .deleteMessage(ctx.message.message_id)
            .catch((e) => console.error("Delete user msg error", e));
          return;
        }
        data.subjects[state.sIdx].tasks[state.tIdx].title = title;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Заголовок обновлён!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в задании?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_task_title_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_task_emoji_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_task_description_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_task_attachments_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "✅ Готово",
                  `task_${state.sIdx}_${state.tIdx}`
                ),
              ],
            ])
          );
        } catch (e) {
          console.error("[edit_task title finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_emoji") {
        data.subjects[state.sIdx].tasks[state.tIdx].emoji = text || "📄";
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Emoji обновлён!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в задании?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_task_title_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_task_emoji_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_task_description_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_task_attachments_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "✅ Готово",
                  `task_${state.sIdx}_${state.tIdx}`
                ),
              ],
            ])
          );
        } catch (e) {
          console.error("[edit_task emoji finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
      if (state.step === "edit_description") {
        data.subjects[state.sIdx].tasks[state.tIdx].description = text;
        saveData(data);
        delete inputState[ctx.from.id];
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Описание обновлено!\n\n---", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await editOrSend(
            ctx,
            `✏️ Что хотите изменить в задании?\n\n---`,
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "📝 Заголовок",
                  `edit_task_title_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "😀 Emoji",
                  `edit_task_emoji_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📄 Описание",
                  `edit_task_description_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "📎 Вложения",
                  `edit_task_attachments_${state.sIdx}_${state.tIdx}`
                ),
              ],
              [
                Markup.button.callback(
                  "✅ Готово",
                  `task_${state.sIdx}_${state.tIdx}`
                ),
              ],
            ])
          );
        } catch (e) {
          console.error("[edit_task description finish error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
    }

    // Добавление ответа (если текст)
    if (state && state.mode === "add_answer" && state.step === "answer") {
      if (text) {
        state.answers.push({ type: "text", content: text, local_path: null });
        try {
          await trackSend(ctx, () =>
            ctx.reply("✅ Текст добавлен. Добавьте ещё или нажмите Готово.", {
              disable_notification: !isPrivate(ctx),
            })
          );
        } catch (e) {
          console.error("[add_answer text error]", e);
        }
        await ctx
          .deleteMessage(ctx.message.message_id)
          .catch((e) => console.error("Delete user msg error", e));
        return;
      }
    }
  });

  // Пропуски для добавления предмета
  bot.action("skip_lecturer_name", async (ctx) => {
    const state = inputState[ctx.from.id];
    if (
      !state ||
      state.mode !== "add_subject" ||
      state.step !== "lecturer_name"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_lecturer_name error]", e);
      }
      return;
    }
    state.lecturerName = "";
    state.step = "lecturer_contact";
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          "📞 Введите контакты лектора (соц. сети, почта и т.д.) (или пропустите):",
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("Пропустить", "skip_lecturer_contact")],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[skip_lecturer_name prompt error]", e);
    }
  });

  bot.action("skip_lecturer_contact", async (ctx) => {
    const state = inputState[ctx.from.id];
    if (
      !state ||
      state.mode !== "add_subject" ||
      state.step !== "lecturer_contact"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_lecturer_contact error]", e);
      }
      return;
    }
    state.lecturerContact = "";
    state.step = "practitioner_name";
    try {
      await trackSend(ctx, () =>
        ctx.reply("👩‍🏫 Введите ФИО практики (или пропустите):", {
          ...Markup.inlineKeyboard([
            [Markup.button.callback("Пропустить", "skip_practitioner_name")],
          ]),
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[skip_lecturer_contact prompt error]", e);
    }
  });

  bot.action("skip_practitioner_name", async (ctx) => {
    const state = inputState[ctx.from.id];
    if (
      !state ||
      state.mode !== "add_subject" ||
      state.step !== "practitioner_name"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_practitioner_name error]", e);
      }
      return;
    }
    state.practitionerName = "";
    state.step = "practitioner_contact";
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          "📞 Введите контакты практики (соц. сети, почта и т.д.) (или пропустите):",
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "Пропустить",
                  "skip_practitioner_contact"
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[skip_practitioner_name prompt error]", e);
    }
  });

  bot.action("skip_practitioner_contact", async (ctx) => {
    const state = inputState[ctx.from.id];
    if (
      !state ||
      state.mode !== "add_subject" ||
      state.step !== "practitioner_contact"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_practitioner_contact error]", e);
      }
      return;
    }
    state.practitionerContact = "";
    data.subjects.push({
      name: state.name,
      emoji: state.emoji,
      lecturerName: state.lecturerName,
      lecturerContact: state.lecturerContact,
      practitionerName: state.practitionerName,
      practitionerContact: state.practitionerContact,
      tasks: [],
    });
    saveData(data);
    delete inputState[ctx.from.id];
    try {
      await trackSend(ctx, () =>
        ctx.reply("✅ Предмет добавлен!\n\n---", {
          disable_notification: !isPrivate(ctx),
        })
      );
      await mainMenu(ctx);
    } catch (e) {
      console.error("[skip_practitioner_contact finish error]", e);
    }
  });

  // Пропуски для добавления информации
  bot.action(/^skip_info_description(_(\d+))?$/, async (ctx) => {
    const state = inputState[ctx.from.id];
    const idx = ctx.match[2] ? Number(ctx.match[2]) : undefined;
    if (
      !state ||
      (idx !== undefined && state.idx !== idx) ||
      state.step !== "description"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_info_description error]", e);
      }
      return;
    }
    state.description = "";
    state.step = "attachments";
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          '📎 Отправьте файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---',
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "✅ Готово",
                  idx
                    ? `finish_info_attachments_${idx}`
                    : "finish_info_attachments"
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[skip_info_description prompt error]", e);
    }
  });

  // Редактирование предмета
  bot.action(/^edit_subject_name_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = { mode: "edit_subject", step: "name", sIdx };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📘 Введите новое название:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_name prompt error]", e);
    }
  });

  bot.action(/^edit_subject_emoji_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = { mode: "edit_subject", step: "emoji", sIdx };
    try {
      await trackSend(ctx, () =>
        ctx.reply("😀 Введите новый emoji:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_emoji prompt error]", e);
    }
  });

  bot.action(/^edit_subject_lecturer_name_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_subject",
      step: "lecturer_name",
      sIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("👨‍🏫 Введите новое ФИО лектора:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_lecturer_name prompt error]", e);
    }
  });

  bot.action(/^edit_subject_lecturer_contact_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_subject",
      step: "lecturer_contact",
      sIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📞 Введите новые контакты лектора:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_lecturer_contact prompt error]", e);
    }
  });

  bot.action(/^edit_subject_practitioner_name_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_subject",
      step: "practitioner_name",
      sIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("👩‍🏫 Введите новое ФИО практики:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_practitioner_name prompt error]", e);
    }
  });

  bot.action(/^edit_subject_practitioner_contact_(\d+)$/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_subject",
      step: "practitioner_contact",
      sIdx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📞 Введите новые контакты практики:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_subject_practitioner_contact prompt error]", e);
    }
  });

  // Редактирование информации
  bot.action(/^edit_info_title_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    inputState[ctx.from.id] = { mode: "edit_info", step: "edit_title", idx };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📝 Введите новый заголовок:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_info_title prompt error]", e);
    }
  });

  bot.action(/^edit_info_emoji_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    inputState[ctx.from.id] = { mode: "edit_info", step: "edit_emoji", idx };
    try {
      await trackSend(ctx, () =>
        ctx.reply("😀 Введите новый emoji:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_info_emoji prompt error]", e);
    }
  });

  bot.action(/^edit_info_description_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_info",
      step: "edit_description",
      idx,
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply("📄 Введите новое описание:", {
          disable_notification: !isPrivate(ctx),
        })
      );
    } catch (e) {
      console.error("[edit_info_description prompt error]", e);
    }
  });

  bot.action(/^edit_info_attachments_(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    inputState[ctx.from.id] = {
      mode: "edit_info",
      step: "attachments",
      idx,
      attachments: [],
    };
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          '📎 Отправьте новые файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---',
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "✅ Готово",
                  `finish_info_attachments_${idx}`
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[edit_info_attachments prompt error]", e);
    }
  });

  // Для задач - пропуски
  bot.action(/^skip_description_(\d+)(_(\d+))?$/, async (ctx) => {
    const state = inputState[ctx.from.id];
    const sIdx = Number(ctx.match[1]);
    const tIdx = ctx.match[3] ? Number(ctx.match[3]) : undefined;
    if (
      !state ||
      state.sIdx !== sIdx ||
      (tIdx !== undefined && state.tIdx !== tIdx) ||
      state.step !== "description"
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[skip_description error]", e);
      }
      return;
    }
    state.description = "";
    state.step = "attachments";
    try {
      await trackSend(ctx, () =>
        ctx.reply(
          '📎 Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".\n\n---',
          {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "✅ Готово",
                  tIdx
                    ? `finish_attachments_${sIdx}_${tIdx}`
                    : `finish_attachments_${sIdx}`
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          }
        )
      );
    } catch (e) {
      console.error("[skip_description prompt error]", e);
    }
  });

  bot.on("document", async (ctx) => {
    console.log(
      "[DOCUMENT] from",
      ctx.from && ctx.from.username,
      "fileName=",
      ctx.message.document && ctx.message.document.file_name
    );
    const state = inputState[ctx.from.id];
    if (!state) return;
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;
    try {
      if (state.step === "attachments" || state.step === "edit_attachments") {
        const file_id = ctx.message.document.file_id;
        const local_path = await saveAttachment(ctx, file_id, "document");
        state.attachments.push({
          type: "document",
          file_id: file_id,
          local_path,
        });
        await trackSend(ctx, () =>
          ctx.reply(
            "✅ Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'.",
            { disable_notification: !isPrivate(ctx) }
          )
        );
      }
      if (state && state.mode === "add_answer" && state.step === "answer") {
        const file_id = ctx.message.document.file_id;
        const local_path = await saveAttachment(ctx, file_id, "document");
        state.answers.push({
          type: "document",
          file_id: file_id,
          local_path,
        });
        await trackSend(ctx, () =>
          ctx.reply("✅ Файл добавлен. Добавьте ещё или нажмите Готово.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
    } catch (e) {
      console.error("[document handler error]", e);
    } finally {
      await ctx
        .deleteMessage(ctx.message.message_id)
        .catch((e) => console.error("Delete user msg error", e));
    }
  });

  bot.on("photo", async (ctx) => {
    console.log(
      "[PHOTO] from",
      ctx.from && ctx.from.username,
      "photoCount=",
      ctx.message.photo && ctx.message.photo.length
    );
    const state = inputState[ctx.from.id];
    if (!state) return;
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;
    try {
      if (state.step === "attachments" || state.step === "edit_attachments") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const largest = photo[photo.length - 1];
          const file_id = largest.file_id;
          const local_path = await saveAttachment(ctx, file_id, "photo");
          state.attachments.push({
            type: "photo",
            file_id: file_id,
            local_path,
          });
          await trackSend(ctx, () =>
            ctx.reply(
              "✅ Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'.",
              { disable_notification: !isPrivate(ctx) }
            )
          );
        }
      }
      if (state && state.mode === "add_answer" && state.step === "answer") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const largest = photo[photo.length - 1];
          const file_id = largest.file_id;
          const local_path = await saveAttachment(ctx, file_id, "photo");
          state.answers.push({
            type: "photo",
            file_id: file_id,
            local_path,
          });
          await trackSend(ctx, () =>
            ctx.reply("✅ Фото добавлено. Добавьте ещё или нажмите Готово.", {
              disable_notification: !isPrivate(ctx),
            })
          );
        }
      }
    } catch (e) {
      console.error("[photo handler error]", e);
    } finally {
      await ctx
        .deleteMessage(ctx.message.message_id)
        .catch((e) => console.error("Delete user msg error", e));
    }
  });

  // Завершение вложений для задания
  bot.action(/^finish_attachments_(\d+)(_(\d+))?$/, async (ctx) => {
    const state = inputState[ctx.from.id];
    const sIdx = Number(ctx.match[1]);
    const tIdx = ctx.match[3] ? Number(ctx.match[3]) : undefined;
    if (
      !state ||
      state.sIdx !== sIdx ||
      (tIdx !== undefined && state.tIdx !== tIdx)
    ) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[finish_attachments error]", e);
      }
      return;
    }
    if (state.mode === "add_task") {
      const newTask = {
        title: state.title,
        description: state.description,
        attachments: state.attachments,
        answers: [],
        emoji: state.emoji || "📄",
      };
      data.subjects[state.sIdx].tasks.push(newTask);
    } else if (state.mode === "edit_task" && state.step === "attachments") {
      // Delete old attachments files
      const old_attachments =
        data.subjects[state.sIdx].tasks[state.tIdx].attachments || [];
      for (const att of old_attachments) {
        deleteAttachment(att.local_path);
      }
      data.subjects[state.sIdx].tasks[state.tIdx].attachments =
        state.attachments;
    }
    saveData(data);
    delete inputState[ctx.from.id];
    console.log("[INFO] attachments finished", {
      sIdx: state.sIdx,
      tIdx: state.tIdx,
    });
    try {
      await trackSend(ctx, () =>
        ctx.reply("✅ Задание сохранено!\n\n---", {
          disable_notification: !isPrivate(ctx),
        })
      );
      await mainMenu(ctx);
    } catch (e) {
      console.error("[finish_attachments finish error]", e);
    }
    return;
  });

  // Завершение вложений для информации
  bot.action(/^finish_info_attachments(_(\d+))?$/, async (ctx) => {
    const state = inputState[ctx.from.id];
    const idx = ctx.match[2] ? Number(ctx.match[2]) : undefined;
    if (!state || (idx !== undefined && state.idx !== idx)) {
      try {
        await trackSend(ctx, () =>
          ctx.reply("❌ Ошибка состояния.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      } catch (e) {
        console.error("[finish_info_attachments error]", e);
      }
      return;
    }
    if (state.mode === "add_info") {
      const newInfo = {
        title: state.title,
        description: state.description,
        attachments: state.attachments,
        emoji: state.emoji || "ℹ️",
      };
      data.infos.push(newInfo);
    } else {
      // Delete old attachments files
      const old_attachments = data.infos[state.idx].attachments || [];
      for (const att of old_attachments) {
        deleteAttachment(att.local_path);
      }
      data.infos[state.idx].attachments = state.attachments;
    }
    saveData(data);
    delete inputState[ctx.from.id];
    console.log("[INFO] info attachments finished", { idx: state.idx });
    try {
      await trackSend(ctx, () =>
        ctx.reply("✅ Информация сохранена!\n\n---", {
          disable_notification: !isPrivate(ctx),
        })
      );
      await mainMenu(ctx);
    } catch (e) {
      console.error("[finish_info_attachments finish error]", e);
    }
    return;
  });

  // Admin Tools
  bot.action("tools", async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
      return;
    }
    await editOrSend(
      ctx,
      "🛠 Инструменты\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("Перекличка", "roll_call")],
        [Markup.button.callback("Очистка", "cleanup")],
        [Markup.button.callback("⬅️ Назад", "main_menu")],
      ])
    );
  });

  bot.action("roll_call", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const allUsers = [
      ...new Set([
        ...data.users.ADMINS,
        ...data.users.ANSWER_VIEWERS,
        ...data.users.SUPERUSERS,
      ]),
    ];
    const msg = allUsers.join("\n");
    for (let i = 0; i < 3; i++) {
      await trackSend(ctx, () =>
        ctx.reply(msg, { disable_notification: !isPrivate(ctx) })
      );
    }
  });

  bot.action("cleanup", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const chatId = ctx.chat.id;
    const messageIds = data.chatMessages[chatId] || [];
    for (const id of messageIds) {
      await ctx.telegram
        .deleteMessage(chatId, id)
        .catch((e) => console.error(`Delete error for ${id}`, e));
    }
    data.chatMessages[chatId] = [];
    saveData(data);
    await trackSend(ctx, () =>
      ctx.reply("Очистка завершена.", { disable_notification: !isPrivate(ctx) })
    );
  });

  // Сброс состояний при callback_query
  bot.on("callback_query", async (ctx) => {
    try {
      if (
        !ctx.callbackQuery.data.startsWith("edit_") &&
        !ctx.callbackQuery.data.startsWith("add_")
      ) {
        delete inputState[ctx.from.id];
      }
    } catch (e) {
      console.error("[callback_query error]", e);
    }
  });
}

module.exports = subjectsHandler;
