const { Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");

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
      if (!json.subjectEmojis) json.subjectEmojis = {};
      return json;
    } catch (e) {
      return {
        users: DEFAULT_USERS,
        subjects: [],
        subjectEmojis: {},
      };
    }
  }
  return {
    users: DEFAULT_USERS,
    subjects: [],
    subjectEmojis: {},
  };
}
function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}
function saveAttachment(fileId, buffer, ext = "") {
  const filePath = path.join(ATTACHMENTS_DIR, `${fileId}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
const data = loadData();

function isAdmin(ctx) {
  return (
    ctx.from &&
    Array.isArray(data.users?.ADMINS) &&
    Array.isArray(data.users?.SUPERUSERS) &&
    (data.users.ADMINS.includes(`@${ctx.from.username}`) ||
      data.users.SUPERUSERS.includes(`@${ctx.from.username}`))
  );
}
function isAnswerViewer(ctx) {
  return (
    ctx.from &&
    Array.isArray(data.users?.ANSWER_VIEWERS) &&
    Array.isArray(data.users?.SUPERUSERS) &&
    (data.users.ANSWER_VIEWERS.includes(`@${ctx.from.username}`) ||
      data.users.SUPERUSERS.includes(`@${ctx.from.username}`))
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
const replyKeyboard = Markup.keyboard([["/start"]]).resize();
async function mainMenu(ctx) {
  const buttons = [
    [Markup.button.callback("📚 Предметы", "subjects")],
    [Markup.button.callback("⚙️ Настройки", "settings")],
  ];
  return await ctx.reply("Главное меню", {
    reply_markup: Markup.inlineKeyboard(buttons),
    parse_mode: "HTML",
  });
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
      const sent = await ctx.reply(text, { ...keyboard, parse_mode: "HTML" });
      interactiveMessageId[ctx.chat.id] = sent.message_id;
    }
  } catch (e) {
    console.error("[editOrSend error]", e);
    const sent = await ctx.reply(text, { ...keyboard, parse_mode: "HTML" });
    interactiveMessageId[ctx.chat.id] = sent.message_id;
  }
}
function subjectsHandler(bot) {
  bot.start((ctx) => {
    return ctx.reply(
      "📌 Главное меню",
      Markup.inlineKeyboard([
        [Markup.button.callback("📚 Предметы", "subjects")],
        [Markup.button.callback("⚙️ Настройки", "settings")],
      ])
    );
  });
  bot.action("main_menu", async (ctx) => {
    const buttons = [
      [Markup.button.callback("📚 Предметы", "subjects")],
      [Markup.button.callback("⚙️ Настройки", "settings")],
    ];
    await editOrSend(ctx, "Главное меню", Markup.inlineKeyboard(buttons));
  });

  // Добавление emoji для предмета
  const subjectEmojis = {};

  // Изменённый вывод списка предметов
  bot.action("subjects", async (ctx) => {
    if (data.subjects.length === 0) {
      const buttons = [];
      if (isAdmin(ctx)) {
        buttons.push([
          Markup.button.callback("➕ Добавить предмет", "add_subject"),
        ]);
      }
      buttons.push([Markup.button.callback("⬅ Назад", "main_menu")]);
      await editOrSend(ctx, "Нет предметов.", Markup.inlineKeyboard(buttons));
      return; // чтобы не отправлять лишнее сообщение
    }
    let msg = "Список предметов:\n";
    data.subjects.forEach((s, i) => {
      const emoji = data.subjectEmojis[s.name] || "📚";
      msg += `${emoji} ${s.name}\n`;
    });
    // Формируем кнопки по 3 в ряд
    const subjectButtons = [];
    for (let i = 0; i < data.subjects.length; i += 3) {
      subjectButtons.push(
        data.subjects
          .slice(i, i + 3)
          .map((s, j) =>
            Markup.button.callback(
              data.subjectEmojis[s.name] || "📚",
              `subject_${i + j}`
            )
          )
      );
    }
    const buttons = [...subjectButtons];
    if (isAdmin(ctx)) {
      buttons.push([
        Markup.button.callback("➕ Добавить предмет", "add_subject"),
      ]);
    }
    buttons.push([Markup.button.callback("⬅ Назад", "main_menu")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  bot.action(/subject_(\d+)/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const subject = data.subjects[idx];
    if (!subject)
      return editOrSend(
        ctx,
        "Предмет не найден.",
        Markup.inlineKeyboard([[Markup.button.callback("⬅ Назад", "subjects")]])
      );
    // Формируем текстовый список заданий
    let msg = `Предмет: ${subject.name}\n`;
    if (subject.tasks.length === 0) {
      msg += "Нет заданий.\n";
    } else {
      msg += "Задания:\n";
      subject.tasks.forEach((t, i) => {
        msg += `${t.emoji || "📄"} ${t.title}\n`;
      });
    }
    // Формируем кнопки заданий по 3 в ряд, показываем только иконки
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
        Markup.button.callback("🗑 Удалить предмет", `delete_subject_${idx}`),
      ]);
    }
    buttons.push([Markup.button.callback("⬅ Назад", "subjects")]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  bot.action(/task_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    const subject = data.subjects[sIdx];
    const task = subject?.tasks[tIdx];
    if (!task)
      return editOrSend(
        ctx,
        "Задание не найдено.",
        Markup.inlineKeyboard([
          [Markup.button.callback("⬅ Назад", `subject_${sIdx}`)],
        ])
      );
    let msg = `*${task.title}*`;
    if (task.description) msg += `\n${task.description}`;
    let buttons = [];
    if (isAnswerViewer(ctx) && task.answers?.length) {
      buttons.push([
        Markup.button.callback(
          "📖 Показать ответы",
          `show_answers_${sIdx}_${tIdx}`
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
          "🗑 Удалить задание",
          `delete_task_${sIdx}_${tIdx}`
        ),
      ]);
      // Кнопка редактирования
      buttons.push([
        Markup.button.callback(
          "✏️ Редактировать",
          `edit_task_menu_${sIdx}_${tIdx}`
        ),
      ]);
    }
    buttons.push([Markup.button.callback("⬅ Назад", `subject_${sIdx}`)]);
    await editOrSend(ctx, msg, Markup.inlineKeyboard(buttons));
  });

  // Меню редактирования задачи
  bot.action(/edit_task_menu_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    await editOrSend(
      ctx,
      `Что хотите изменить?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✏️ Заголовок",
            `edit_task_title_${sIdx}_${tIdx}`
          ),
        ],
        [Markup.button.callback("✏️ Emoji", `edit_task_emoji_${sIdx}_${tIdx}`)],
        [
          Markup.button.callback(
            "✏️ Описание",
            `edit_task_description_${sIdx}_${tIdx}`
          ),
        ],
        [
          Markup.button.callback(
            "✏️ Вложения",
            `edit_task_attachments_${sIdx}_${tIdx}`
          ),
        ],
        [Markup.button.callback("✅ Готово", `task_${sIdx}_${tIdx}`)],
      ])
    );
  });

  const waitingForInput = {};
  const taskInputState = {};

  // Добавление предмета
  bot.action("add_subject", async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("Нет прав.");
    waitingForInput[ctx.from.id] = "add_subject_name";
    await ctx.reply("Введите название нового предмета:");
  });

  bot.on("text", async (ctx) => {
    if (ctx.message.text === "/start") {
      delete waitingForInput[ctx.from.id];
      delete taskInputState[ctx.from.id];
      await mainMenu(ctx);
      return;
    }

    // --- Обработка кнопки Reply Keyboard ---
    if (ctx.message.text === "🏠 Главное меню") {
      delete waitingForInput[ctx.from.id];
      delete taskInputState[ctx.from.id];
      await mainMenu(ctx);
      return;
    }

    // Фильтрации: слушаем только от инициатора
    const mode = waitingForInput[ctx.from.id];
    const taskState = taskInputState[ctx.from.id];
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;

    // --- Добавление предмета ---
    if (mode === "add_subject_name") {
      const name = ctx.message.text.trim();
      if (!name) return ctx.reply("Название не может быть пустым.");
      waitingForInput[ctx.from.id] = "add_subject_emoji";
      waitingForInput[`${ctx.from.id}_subjectName`] = name;
      await ctx.reply("Введите смайлик для предмета (например, 📐):");
      return;
    }
    if (mode === "add_subject_emoji") {
      const emoji = ctx.message.text.trim();
      const name = waitingForInput[`${ctx.from.id}_subjectName`];
      data.subjects.push({ name, tasks: [] });
      data.subjectEmojis[name] = emoji || "📚";
      saveData(data);
      delete waitingForInput[ctx.from.id];
      delete waitingForInput[`${ctx.from.id}_subjectName`];
      await ctx.reply(`Предмет "${emoji || "📚"} ${name}" добавлен!`);
      await mainMenu(ctx);
      return;
    }

    // --- Добавление админа ---
    if (taskState && taskState.step === "add_admin") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.ADMINS.includes(username))
        return ctx.reply("Уже есть такой админ.");
      data.users.ADMINS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`Админ ${username} добавлен.`);
      showAdminMenu(ctx);
      console.log(`[LOG] ${ctx.from.username} добавил админа: ${username}`);
      return;
    }
    // --- Добавление ANSWER_VIEWER ---
    if (taskState && taskState.step === "add_viewer") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.ANSWER_VIEWERS.includes(username))
        return ctx.reply("Уже есть такой ANSWER_VIEWER.");
      data.users.ANSWER_VIEWERS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`ANSWER_VIEWER ${username} добавлен.`);
      await refreshAnswerViewers(ctx);
      console.log(
        `[LOG] ${ctx.from.username} добавил ANSWER_VIEWER: ${username}`
      );
      return;
    }
    // --- Добавление SUPERUSER ---
    if (taskState && taskState.step === "add_superuser") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.SUPERUSERS.includes(username))
        return ctx.reply("Уже есть такой SUPERUSER.");
      data.users.SUPERUSERS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`SUPERUSER ${username} добавлен.`);
      showSuperusersMenu(ctx);
      console.log(`[LOG] ${ctx.from.username} добавил SUPERUSER: ${username}`);
      return;
    }

    // --- Добавление задания ---
    if (taskState && taskState.step === "title") {
      const title = ctx.message.text.trim();
      if (!title) return ctx.reply("Заголовок не может быть пустым.");
      taskState.title = title;
      taskState.step = "emoji";
      await ctx.reply("Введите смайлик для задания (например, 📄):");
      return;
    }
    if (taskState && taskState.step === "emoji") {
      taskState.emoji = ctx.message.text.trim() || "📄";
      taskState.step = "description";
      await ctx.reply(
        "Введите описание (или пропустите):",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "Пропустить",
              `skip_description_${taskState.sIdx}`
            ),
          ],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "description") {
      taskState.description = ctx.message.text.trim();
      taskState.step = "attachments";
      await ctx.reply(
        'Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".',
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Готово",
              `finish_attachments_${taskState.sIdx}`
            ),
          ],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "answer") {
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].answers.push(
        ctx.message.text
      );
      saveData(data);
      await ctx.reply("Ответ добавлен!");
      delete taskInputState[ctx.from.id];
      return;
    }

    // --- Редактирование задачи ---
    if (taskState && taskState.step === "edit_title") {
      const title = ctx.message.text.trim();
      if (!title) return ctx.reply("Заголовок не может быть пустым.");
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].title = title;
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Заголовок обновлён!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✅ Готово",
              `task_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "edit_emoji") {
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].emoji =
        ctx.message.text.trim() || "📄";
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Emoji обновлён!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✅ Готово",
              `task_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "edit_description") {
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].description =
        ctx.message.text.trim();
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Описание обновлено!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✅ Готово",
              `task_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
        ])
      );
      return;
    }
    // --- Если не обработано, не стираем состояния! ---
  });

  bot.action(/skip_description_(\d+)/, async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (
      !taskState ||
      taskState.sIdx !== Number(ctx.match[1]) ||
      taskState.step !== "description"
    )
      return ctx.reply("Ошибка состояния.");
    taskState.description = "";
    taskState.step = "attachments";
    await ctx.reply(
      'Отправьте файлы/фото для задания. Когда закончите, нажмите "✅ Готово".',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✅ Готово",
            `finish_attachments_${taskState.sIdx}`
          ),
        ],
      ])
    );
  });

  bot.on("document", async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (!taskState) return;
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;
    if (taskState.step === "attachments") {
      taskState.attachments.push(ctx.message.document.file_id);
      await ctx.reply(
        "Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'."
      );
    }
    const state = taskInputState[ctx.from.id];
    if (state && state.step === "answer") {
      data.subjects[state.sIdx].tasks[state.tIdx].answers.push(
        ctx.message.document.file_id
      );
      saveData(data);
      await ctx.reply("Ответ (файл) добавлен!");
      delete taskInputState[ctx.from.id];
      return;
    }
  });

  bot.on("photo", async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (!taskState) return;
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;
    if (taskState.step === "attachments") {
      // Берём file_id самого большого фото
      const photo = ctx.message.photo;
      if (photo && photo.length) {
        const largest = photo[photo.length - 1];
        taskState.attachments.push(largest.file_id);
        await ctx.reply(
          "Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'."
        );
      }
    }
  });

  // Добавление задания
  bot.action(/add_task_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("Нет прав.");
    const sIdx = Number(ctx.match[1]);
    taskInputState[ctx.from.id] = {
      step: "title",
      sIdx,
      title: "",
      description: "",
      attachments: [],
      emoji: "",
    };
    await ctx.reply("Введите заголовок задания:");
  });

  bot.action(/finish_attachments_(\d+)/, async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (!taskState || taskState.sIdx !== Number(ctx.match[1]))
      return ctx.reply("Ошибка состояния.");
    // Добавляем задачу
    const newTask = {
      title: taskState.title,
      description: taskState.description,
      attachments: taskState.attachments,
      answers: [],
      emoji: taskState.emoji || "📄",
    };
    data.subjects[taskState.sIdx].tasks.push(newTask);
    saveData(data);
    const tIdx = data.subjects[taskState.sIdx].tasks.length - 1;
    delete taskInputState[ctx.from.id];
    await ctx.reply("Задание добавлено!");
    // После добавления задания сразу предлагаем редактировать
    await editOrSend(
      ctx,
      `Задание добавлено!\nЧто хотите изменить?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✏️ Заголовок",
            `edit_task_title_${taskState.sIdx}_${tIdx}`
          ),
        ],
        [
          Markup.button.callback(
            "✏️ Emoji",
            `edit_task_emoji_${taskState.sIdx}_${tIdx}`
          ),
        ],
        [
          Markup.button.callback(
            "✏️ Описание",
            `edit_task_description_${taskState.sIdx}_${tIdx}`
          ),
        ],
        [
          Markup.button.callback(
            "✏️ Вложения",
            `edit_task_attachments_${taskState.sIdx}_${tIdx}`
          ),
        ],
        [Markup.button.callback("✅ Готово", `subject_${taskState.sIdx}`)],
      ])
    );
  });

  // --- Редактирование задачи ---
  bot.action(/edit_task_title_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    taskInputState[ctx.from.id] = { step: "edit_title", sIdx, tIdx };
    await ctx.reply("Введите новый заголовок:");
  });
  bot.action(/edit_task_emoji_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    taskInputState[ctx.from.id] = { step: "edit_emoji", sIdx, tIdx };
    await ctx.reply("Введите новый emoji:");
  });
  bot.action(/edit_task_description_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    taskInputState[ctx.from.id] = { step: "edit_description", sIdx, tIdx };
    await ctx.reply("Введите новое описание:");
  });
  bot.action(/edit_task_attachments_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    taskInputState[ctx.from.id] = {
      step: "edit_attachments",
      sIdx,
      tIdx,
      attachments: [],
    };
    await ctx.reply(
      'Отправьте новые файлы/фото для задания. Когда закончите, нажмите "✅ Готово".',
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✅ Готово",
            `finish_edit_attachments_${sIdx}_${tIdx}`
          ),
        ],
      ])
    );
  });
  bot.action(/finish_edit_attachments_(\d+)_(\d+)/, async (ctx) => {
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    const state = taskInputState[ctx.from.id];
    if (!state || state.sIdx !== sIdx || state.tIdx !== tIdx)
      return ctx.reply("Ошибка состояния.");
    data.subjects[sIdx].tasks[tIdx].attachments = state.attachments;
    saveData(data);
    delete taskInputState[ctx.from.id];
    await ctx.reply("Вложения обновлены!");
    await editOrSend(
      ctx,
      `Что хотите изменить?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✏️ Заголовок",
            `edit_task_title_${sIdx}_${tIdx}`
          ),
        ],
        [Markup.button.callback("✏️ Emoji", `edit_task_emoji_${sIdx}_${tIdx}`)],
        [
          Markup.button.callback(
            "✏️ Описание",
            `edit_task_description_${sIdx}_${tIdx}`
          ),
        ],
        [
          Markup.button.callback(
            "✏️ Вложения",
            `edit_task_attachments_${sIdx}_${tIdx}`
          ),
        ],
        [Markup.button.callback("✅ Готово", `subject_${sIdx}`)],
      ])
    );
  });

  // --- Обработка текстовых сообщений для редактирования ---
  bot.on("text", async (ctx) => {
    const mode = waitingForInput[ctx.from.id];
    const taskState = taskInputState[ctx.from.id];
    if (
      ctx.update.message &&
      ctx.update.message.from &&
      ctx.update.message.from.id !== ctx.from.id
    )
      return;

    // --- Редактирование задачи ---
    if (taskState && taskState.step === "edit_title") {
      const title = ctx.message.text.trim();
      if (!title) return ctx.reply("Заголовок не может быть пустым.");
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].title = title;
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Заголовок обновлён!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [Markup.button.callback("✅ Готово", `subject_${taskState.sIdx}`)],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "edit_emoji") {
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].emoji =
        ctx.message.text.trim() || "📄";
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Emoji обновлён!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✅ Готово",
              `task_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
        ])
      );
      return;
    }
    if (taskState && taskState.step === "edit_description") {
      data.subjects[taskState.sIdx].tasks[taskState.tIdx].description =
        ctx.message.text.trim();
      saveData(data);
      delete taskInputState[ctx.from.id];
      await ctx.reply("Описание обновлено!");
      await editOrSend(
        ctx,
        `Что хотите изменить?`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✏️ Заголовок",
              `edit_task_title_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Emoji",
              `edit_task_emoji_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Описание",
              `edit_task_description_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✏️ Вложения",
              `edit_task_attachments_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
          [
            Markup.button.callback(
              "✅ Готово",
              `task_${taskState.sIdx}_${taskState.tIdx}`
            ),
          ],
        ])
      );
      return;
    }
  });

  // --- Обработка вложений для редактирования ---
  bot.on("document", async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (taskState && taskState.step === "edit_attachments") {
      taskState.attachments.push(ctx.message.document.file_id);
      await ctx.reply(
        "Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'."
      );
      return;
    }
    const state = taskInputState[ctx.from.id];
    if (state && state.step === "answer") {
      data.subjects[state.sIdx].tasks[state.tIdx].answers.push(
        ctx.message.document.file_id
      );
      saveData(data);
      await ctx.reply("Ответ (файл) добавлен!");
      delete taskInputState[ctx.from.id];
      return;
    }
  });
  bot.on("photo", async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (taskState && taskState.step === "edit_attachments") {
      const photo = ctx.message.photo;
      if (photo && photo.length) {
        const largest = photo[photo.length - 1];
        taskState.attachments.push(largest.file_id);
        await ctx.reply(
          "Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'."
        );
      }
      return;
    }
  });

  // Удаление предмета
  bot.action(/delete_subject_(\d+)/, async (ctx) => {
    console.log(`[DEBUG] delete_subject triggered by ${ctx.from.username}`);
    if (!isAdmin(ctx)) return ctx.reply("Нет прав.");
    const idx = Number(ctx.match[1]);
    if (!data.subjects || !data.subjects[idx])
      return ctx.reply("Предмет не найден.");
    const removed = data.subjects.splice(idx, 1);
    fs.writeFileSync(
      path.resolve(__dirname, "../data.json"),
      JSON.stringify(data, null, 2)
    );
    await ctx.reply(`Предмет ${removed[0]?.name || "?"} удалён.`);
    await mainMenu(ctx);
    console.log(
      `[LOG] ${ctx.from.username} удалил предмет: ${removed[0]?.name}`
    );
  });

  bot.action(/delete_task_(\d+)_(\d+)/, async (ctx) => {
    console.log(`[DEBUG] delete_task triggered by ${ctx.from.username}`);
    if (!isAdmin(ctx)) return ctx.reply("Нет прав.");
    const sIdx = Number(ctx.match[1]);
    const tIdx = Number(ctx.match[2]);
    if (
      !data.subjects ||
      !data.subjects[sIdx] ||
      !data.subjects[sIdx].tasks[tIdx]
    ) {
      return ctx.reply("Задание не найдено.");
    }
    const removed = data.subjects[sIdx].tasks.splice(tIdx, 1);
    fs.writeFileSync(
      path.resolve(__dirname, "../data.json"),
      JSON.stringify(data, null, 2)
    );
    await ctx.reply(`Задание ${removed[0]?.title || "?"} удалено.`);
    await mainMenu(ctx);
    console.log(
      `[LOG] ${ctx.from.username} удалил задание: ${removed[0]?.title}`
    );
  });

  // Обработчик настроек для суперюзеров
  bot.action("settings", async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    await editOrSend(
      ctx,
      "Настройки:",
      Markup.inlineKeyboard([
        [Markup.button.callback("👤 Редактировать ADMINS", "edit_admins")],
        [
          Markup.button.callback(
            "👁 Редактировать ANSWER_VIEWERS",
            "edit_answer_viewers"
          ),
        ],
        [
          Markup.button.callback(
            "⭐ Редактировать SUPERUSERS",
            "edit_superusers"
          ),
        ],
        [Markup.button.callback("⬅ Назад", "main_menu")],
      ])
    );
  });

  // --- Универсальный генератор меню для ролей ---
  function roleMenu(roleArr, roleName, callbackPrefix) {
    let msg = `Текущие ${roleName}:`;
    roleArr.forEach((user, i) => {
      msg += `\n👤 ${user}`;
    });
    const buttons = [];
    for (let i = 0; i < roleArr.length; i += 3) {
      buttons.push(
        roleArr
          .slice(i, i + 3)
          .map((user, j) =>
            Markup.button.callback(
              `🗑 ${user}`,
              `${callbackPrefix}_remove_${i + j}`
            )
          )
      );
    }
    buttons.push([
      Markup.button.callback("➕ Добавить", `${callbackPrefix}_add`),
    ]);
    buttons.push([Markup.button.callback("⬅ Назад", "settings")]);
    return { msg, keyboard: Markup.inlineKeyboard(buttons) };
  }

  // --- Функция обновления меню ANSWER_VIEWERS ---
  async function refreshAnswerViewers(ctx) {
    const { msg, keyboard } = roleMenu(
      data.users.ANSWER_VIEWERS,
      "ANSWER_VIEWERS",
      "viewers"
    );
    await editOrSend(ctx, msg, keyboard);
    console.log(
      `[LOG] ${ctx.from.username} открыл меню редактирования ANSWER_VIEWERS (refresh)`
    );
  }

  // --- Функция обновления меню ADMINS ---
  async function showAdminMenu(ctx) {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    const { msg, keyboard } = roleMenu(data.users.ADMINS, "ADMINS", "admins");
    await editOrSend(ctx, msg, keyboard);
    console.log(
      `[LOG] ${ctx.from.username} открыл меню редактирования ADMINS (showAdminMenu)`
    );
  }
  // --- Функция обновления меню SUPERUSERS ---
  async function showSuperusersMenu(ctx) {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    const { msg, keyboard } = roleMenu(
      data.users.SUPERUSERS,
      "SUPERUSERS",
      "superusers"
    );
    await editOrSend(ctx, msg, keyboard);
    console.log(
      `[LOG] ${ctx.from.username} открыл меню редактирования SUPERUSERS (showSuperusersMenu)`
    );
  }

  // --- Меню для ADMINS ---
  bot.action("edit_admins", showAdminMenu);

  bot.action(/admins_remove_(\d+)/, async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    const idx = Number(ctx.match[1]);
    if (data.users.ADMINS.length <= 1)
      return ctx.reply("Должен быть хотя бы один админ!");
    const removed = data.users.ADMINS.splice(idx, 1);
    require("fs").writeFileSync(
      require("path").resolve(__dirname, "../data.json"),
      JSON.stringify(data, null, 2)
    );
    await ctx.reply(`Админ ${removed} удалён.`);
    await showAdminMenu(ctx);
    console.log(`[LOG] ${ctx.from.username} удалил админа: ${removed}`);
  });

  bot.action("admins_add", async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    taskInputState[ctx.from.id] = { step: "add_admin" };
    await ctx.reply("Введите username нового админа (с @):");
    console.log(`[LOG] ${ctx.from.username} начал добавление нового админа`);
  });

  // --- Меню для ANSWER_VIEWERS ---
  bot.action("edit_answer_viewers", async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    // Принудительно сохраняем message_id вызвавшего callback
    if (ctx.chat && ctx.update.callback_query) {
      interactiveMessageId[ctx.chat.id] =
        ctx.update.callback_query.message.message_id;
      console.log(
        `[DEBUG] edit_answer_viewers: saved interactiveMessageId=${
          interactiveMessageId[ctx.chat.id]
        } for chat ${ctx.chat.id}`
      );
    }
    await refreshAnswerViewers(ctx);
  });

  bot.action(/viewers_remove_(\d+)/, async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    const idx = Number(ctx.match[1]);
    const removed = data.users.ANSWER_VIEWERS.splice(idx, 1);
    require("fs").writeFileSync(
      require("path").resolve(__dirname, "../data.json"),
      JSON.stringify(data, null, 2)
    );
    await ctx.reply(`ANSWER_VIEWER ${removed} удалён.`);
    await refreshAnswerViewers(ctx);
    console.log(`[LOG] ${ctx.from.username} удалил ANSWER_VIEWER: ${removed}`);
  });

  bot.action("viewers_add", async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    taskInputState[ctx.from.id] = { step: "add_viewer" };
    await ctx.reply("Введите username нового ANSWER_VIEWER (с @):");
    console.log(
      `[LOG] ${ctx.from.username} начал добавление нового ANSWER_VIEWER`
    );
  });

  // --- Меню для SUPERUSERS ---
  bot.action("edit_superusers", showSuperusersMenu);

  bot.action(/superusers_remove_(\d+)/, async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    const idx = Number(ctx.match[1]);
    if (data.users.SUPERUSERS.length <= 1)
      return ctx.reply("Должен быть хотя бы один суперюзер!");
    const removed = data.users.SUPERUSERS.splice(idx, 1);
    require("fs").writeFileSync(
      require("path").resolve(__dirname, "../data.json"),
      JSON.stringify(data, null, 2)
    );
    await ctx.reply(`SUPERUSER ${removed} удалён.`);
    await showSuperusersMenu(ctx);
    console.log(`[LOG] ${ctx.from.username} удалил SUPERUSER: ${removed}`);
  });

  bot.action("superusers_add", async (ctx) => {
    if (!isSuperuser(ctx)) return ctx.reply("Нет прав.");
    taskInputState[ctx.from.id] = { step: "add_superuser" };
    await ctx.reply("Введите username нового SUPERUSER (с @):");
    console.log(`[LOG] ${ctx.from.username} начал добавление нового SUPERUSER`);
  });

  // --- Обработка текстовых сообщений для добавления ролей ---
  bot.on("text", async (ctx) => {
    const taskState = taskInputState[ctx.from.id];
    if (taskState && taskState.step === "add_admin") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.ADMINS.includes(username))
        return ctx.reply("Уже есть такой админ.");
      data.users.ADMINS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`Админ ${username} добавлен.`);
      await showAdminMenu(ctx);
      console.log(`[LOG] ${ctx.from.username} добавил админа: ${username}`);
      return;
    }
    if (taskState && taskState.step === "add_viewer") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.ANSWER_VIEWERS.includes(username))
        return ctx.reply("Уже есть такой ANSWER_VIEWER.");
      data.users.ANSWER_VIEWERS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`ANSWER_VIEWER ${username} добавлен.`);
      await refreshAnswerViewers(ctx);
      console.log(
        `[LOG] ${ctx.from.username} добавил ANSWER_VIEWER: ${username}`
      );
      return;
    }
    if (taskState && taskState.step === "add_superuser") {
      const username = ctx.message.text.trim();
      if (!username.startsWith("@")) return ctx.reply("Введите username с @");
      if (data.users.SUPERUSERS.includes(username))
        return ctx.reply("Уже есть такой SUPERUSER.");
      data.users.SUPERUSERS.push(username);
      require("fs").writeFileSync(
        require("path").resolve(__dirname, "../data.json"),
        JSON.stringify(data, null, 2)
      );
      delete taskInputState[ctx.from.id];
      await ctx.reply(`SUPERUSER ${username} добавлен.`);
      await showSuperusersMenu(ctx);
      console.log(`[LOG] ${ctx.from.username} добавил SUPERUSER: ${username}`);
      return;
    }
  });

  // Сброс прослушки любого текстового/инпут состояния при нажатии любой inline-кнопки
  bot.on("callback_query", async (ctx, next) => {
    delete waitingForInput[ctx.from.id];
    delete taskInputState[ctx.from.id];
    return next();
  });
}

module.exports = subjectsHandler;
