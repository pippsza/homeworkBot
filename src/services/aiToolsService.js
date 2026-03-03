const { tool } = require("ai");
const { z } = require("zod");
const subjectService = require("./subjectService");
const infoService = require("./infoService");
const scheduleService = require("./scheduleService");

/**
 * Build assistant tools and system prompt addition for AI chat.
 * Used by both web API (streaming) and bot (non-streaming).
 * @returns {{ tools: object, systemPromptAddition: string, maxSteps: number }}
 */
async function buildAssistantTools({ chatId, username } = {}) {
  const subjects = await subjectService.getAll();
  const subjectsList = subjects
    .map((s) => {
      let desc = `- ${s.emoji || "📚"} ${s.name} (ID: ${s._id})`;
      if (s.lecturerName) desc += ` | Лектор: ${s.lecturerName}`;
      if (s.practitionerName) desc += ` | Практик: ${s.practitionerName}`;
      return desc;
    })
    .join("\n");

  // Build today's schedule context
  let scheduleContext = "";
  try {
    const todaySchedule = await scheduleService.getScheduleForDate(new Date());
    if (todaySchedule.classes.length > 0) {
      const lines = todaySchedule.classes.map(
        (c) => `  ${c.slotNumber}. ${c.startTime}-${c.endTime} ${c.subjectEmoji || "📚"} ${c.subjectName || "?"}`
      );
      scheduleContext = `\nРасписание на сегодня (${todaySchedule.dayName}, неделя ${todaySchedule.weekNumber}, ${todaySchedule.isOdd ? "нечётная" : "чётная"}):\n${lines.join("\n")}`;
    } else {
      scheduleContext = `\nСегодня (${todaySchedule.dayName}) нет занятий.`;
    }
  } catch (e) {
    console.error("[aiTools] schedule context error:", e.message);
  }

  const systemPromptAddition = `\n\nТы — полноценный AI-ассистент для учебного бота. У тебя есть инструменты для управления данными.
Текущий пользователь: ${username || "неизвестен"}
Доступные предметы:
${subjectsList}
${scheduleContext}

ПРАВИЛА ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ/ДОБАВИТЬ ПРЕДМЕТ — ВЫЗОВИ createSubject.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ ДОМАШКУ/ЗАДАНИЕ — ВЫЗОВИ createHomework.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ЗАПОМНИТЬ/СОХРАНИТЬ ИНФОРМАЦИЮ — ВЫЗОВИ rememberInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ ГОВОРИТ ФИО ПРЕПОДАВАТЕЛЯ/ПРАКТИКА ИЛИ ПРОСИТ ОБНОВИТЬ ПРЕДМЕТ — ВЫЗОВИ updateSubject.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ИЗМЕНИТЬ ЗАДАНИЕ — ВЫЗОВИ updateTask.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ О РАСПИСАНИИ НА ДРУГУЮ ДАТУ — ВЫЗОВИ getSchedule.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ РАСПИСАНИЕ ИЛИ ПРОСИТ НАСТРОИТЬ РАСПИСАНИЕ — ВЫЗОВИ setTimeSlots (время пар), затем setDaySchedule для каждого дня (Пн-Пт). Используй ID предметов из списка выше. Для мигалок (чередование по неделям) установи isAlternating: true и укажи subjectId (нечётная) и subjectIdEven (чётная).
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ РЕШИТЬ ДОМАШКУ/ЗАДАНИЕ — вызови listTasks чтобы показать список, спроси какое задание и режим (обычный/PRO), затем вызови solveHomework. Покажи полное решение пользователю.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПОКАЗАТЬ ВСЕ ЗАДАНИЯ/ДОМАШКИ — вызови listTasks без subjectId чтобы получить задания всех предметов.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПОКАЗАТЬ ЗАДАНИЕ/РЕШЕНИЕ/ОТВЕТЫ — вызови getTaskDetails с taskId. Покажи описание, AI-решение и ответы пользователей.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ ТЕКСТОВЫЙ ОТВЕТ НА ЗАДАНИЕ — сначала вызови listTasks чтобы найти ID задания, затем addTaskAnswer.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ ФАЙЛ/ФОТО И ПРОСИТ ПРИКРЕПИТЬ К ЗАДАНИЮ/УСЛОВИЮ — вызови listTasks чтобы найти ID, затем attachFileToTask. file_id и тип бери из метаданных [Прикреплённый файл] или [Прикреплённое фото] в сообщении.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ ФАЙЛ/ФОТО КАК ОТВЕТ/РЕШЕНИЕ — вызови listTasks, затем addFileAnswer с file_id из метаданных.
- Если в сообщении есть метаданные файла [Прикреплённый файл — Telegram file_id: ..., тип: ..., имя: ...] или [Прикреплённое фото — Telegram file_id: ..., тип: ...], это значит пользователь прислал файл. Используй file_id оттуда для прикрепления.
- КОГДА ПОЛЬЗОВАТЕЛЬ ГОВОРИТ "Я СДАЛ" / "Я СДЕЛАЛ" задание — вызови markSubmission (без targetUsername, отметит текущего пользователя).
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "КАКИЕ ЗАДАНИЯ Я СДАЛ" / "МОЙ ПРОГРЕСС" — вызови getMySubmissions.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "КТО СДАЛ задание X" — вызови getTaskSubmissions.
- КОГДА ПОЛЬЗОВАТЕЛЬ ОТМЕЧАЕТ СДАЧУ ЗА ДРУГОГО (напр. "@ivan сдал") — вызови markSubmission с targetUsername.
- КОГДА СПРАШИВАЮТ О ПРЕПОДАВАТЕЛЕ / КОНТАКТАХ — вызови getTeacherInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ УСТАНАВЛИВАЕТ ДЕДЛАЙН — вызови setTaskDeadline. При создании задания спроси есть ли дедлайн.
- КОГДА ПРОСЯТ СОЗДАТЬ ГОЛОСОВАНИЕ/ОПРОС — вызови createPoll. Спроси вопрос и варианты, если не указаны.
- НИКОГДА не отвечай текстом "я сделал" без реального вызова инструмента.
- ПОСЛЕ КАЖДОГО ВЫЗОВА ИНСТРУМЕНТА ОБЯЗАТЕЛЬНО напиши текстовый ответ пользователю с результатами. НИКОГДА не завершай ответ только вызовом инструмента без текста.
  Примеры правильных ответов после вызова инструмента:
  * markSubmission → "Отметил: ты сдал Лабу 1 по криптографии ✅"
  * getTaskSubmissions → "Лаба 1 по криптографии:\n✅ @ivan — сдал\n❌ @peter — не сдал"
  * getMySubmissions → "Твой прогресс:\n✅ Лаба 1 — сдано\n❌ Лаба 2 — не сдано"
  * createHomework → "Создал задание «Лаба 2» в предмете Криптография 🔐"
  * listTasks → перечисли задания в читаемом виде
- ВСЕГДА отвечай на русском языке развёрнуто и по делу. Не пиши просто "Готово" — опиши что было сделано или покажи запрошенные данные.

КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "ЧТО ТЫ УМЕЕШЬ" / "КАКИЕ ВОЗМОЖНОСТИ" / "ПОМОЩЬ" / "ЧТО МОЖНО ДЕЛАТЬ" — расскажи подробно, разделив на интерфейс и чат. Используй информацию ниже.

ВОЗМОЖНОСТИ БОТА — ИНТЕРФЕЙС (кнопки и меню):
- /start → Главное меню с кнопками: Предметы, Информация, Расписание, Настройки, Инструменты, Mini App
- Предметы: просмотр, создание, редактирование предметов (название, эмодзи, ФИО/контакты лектора и практика)
- Задания: создание, редактирование (заголовок, описание, эмодзи), прикрепление файлов/фото, добавление ответов
- Информация: сохранение заметок с заголовком, описанием и файлами
- Расписание: настройка тайм-слотов, расписание на каждый день, мигалки (чередование по неделям), субботы
- Настройки: управление ролями (студенты, супер-админы), настройки моделей AI
- Инструменты: очистка чата, управление базой знаний
- Mini App: веб-интерфейс для удобного просмотра и управления данными
- Пересылка сообщения → бот предложит создать домашку из пересланного текста
- /cancel — отменить текущее действие

ВОЗМОЖНОСТИ БОТА — AI-ЧАТ (написать в чат или /ai):
- /ai <вопрос> — начать диалог с AI (дальше можно писать без команды)
- /noai — отправить одно сообщение без AI, не выходя из режима чата
- Ответ на сообщение бота — начать AI-диалог
- Создание предметов и заданий через чат ("добавь предмет Математика")
- Запоминание информации ("запомни что экзамен 15 января")
- Обновление данных предметов ("лектор по матану — Иванов И.И.", "добавь номер +7... к преподу по физике", "контакт практика — @telegram")
- Решение домашних заданий ("реши домашку" → выбор задания и режима обычный/PRO)
- Просмотр всех заданий и ответов ("покажи все задания", "покажи решение")
- Прикрепление файлов к заданиям (отправить файл + "прикрепи к заданию X")
- Добавление ответов (текст, фото, файлы)
- Отметка сдачи: "я сдал матан" / "какие задания я сдал?" / "кто сдал физику?"
- Установка дедлайнов: "дедлайн по матану — завтра"
- Контакты преподавателей: "кто преподаёт физику?"
- Расписание: "какое расписание на завтра?" / настройка расписания через чат
- Создание голосований: "создай опрос: куда идём на обед?"
- Анализ фото и документов: отправить фото/файл → AI проанализирует содержимое
- Поиск по базе знаний: AI автоматически ищет релевантную информацию

АВТОМАТИЧЕСКИЕ УВЕДОМЛЕНИЯ:
- Напоминания о дедлайнах (за 24ч и 1ч)
- Уведомления о начале пар (за 10 мин)
- Еженедельный дайджест по понедельникам в 08:00`;

  const tools = {
    createSubject: tool({
      description: "Создать новый предмет. Используй когда пользователь просит добавить предмет или когда настраиваешь расписание и нужного предмета нет в списке.",
      inputSchema: z.object({
        name: z.string().describe("Название предмета"),
        emoji: z.string().optional().describe("Эмодзи для предмета (по умолчанию 📚)"),
        lecturerName: z.string().optional().describe("ФИО лектора"),
        practitionerName: z.string().optional().describe("ФИО практика"),
      }),
      execute: async ({ name, emoji, lecturerName, practitionerName }) => {
        console.log("[ai tool] createSubject:", { name });
        const data = { name, emoji: emoji || "📚" };
        if (lecturerName) data.lecturerName = lecturerName;
        if (practitionerName) data.practitionerName = practitionerName;
        const subject = await subjectService.create(data);
        return {
          success: true,
          subjectId: subject._id.toString(),
          subjectName: subject.name,
          subjectEmoji: subject.emoji,
        };
      },
    }),

    createHomework: tool({
      description: "Создать домашнее задание. Используй когда пользователь просит создать, добавить домашку или задание.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета из списка доступных предметов"),
        title: z.string().describe("Название задания (краткое, 5-15 слов)"),
        emoji: z.string().optional().describe("Эмодзи для задания (по умолчанию 📄)"),
        description: z.string().describe("Полное описание задания"),
      }),
      execute: async ({ subjectId, title, emoji, description }) => {
        console.log("[ai tool] createHomework:", { subjectId, title });
        const subject = await subjectService.getById(subjectId);
        if (!subject) return { error: "Предмет не найден" };
        const task = await subjectService.addTask(subjectId, {
          title,
          emoji: emoji || "📄",
          description: description || "",
        });
        return {
          success: true,
          taskTitle: title,
          subjectName: subject.name,
          subjectEmoji: subject.emoji || "📚",
          taskId: task._id.toString(),
        };
      },
    }),

    rememberInfo: tool({
      description: "Запомнить информацию. Используй когда пользователь просит запомнить, сохранить, записать какую-то информацию или факт.",
      inputSchema: z.object({
        title: z.string().describe("Краткий заголовок (3-10 слов)"),
        emoji: z.string().optional().describe("Подходящий emoji (по умолчанию ℹ️)"),
        description: z.string().describe("Полный текст информации для запоминания"),
      }),
      execute: async ({ title, emoji, description }) => {
        console.log("[ai tool] rememberInfo:", { title });
        const info = await infoService.create({
          title,
          emoji: emoji || "ℹ️",
          description,
        });
        return {
          success: true,
          infoTitle: title,
          infoEmoji: emoji || "ℹ️",
          infoId: info._id.toString(),
        };
      },
    }),

    updateSubject: tool({
      description: "Обновить данные предмета: название, эмодзи, ФИО/контакты лектора или практика. Используй когда пользователь сообщает ФИО преподавателя, меняет название предмета и т.д.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета из списка"),
        name: z.string().optional().describe("Новое название предмета"),
        emoji: z.string().optional().describe("Новый эмодзи"),
        lecturerName: z.string().optional().describe("ФИО лектора"),
        lecturerContact: z.string().optional().describe("Контакт лектора"),
        practitionerName: z.string().optional().describe("ФИО практика"),
        practitionerContact: z.string().optional().describe("Контакт практика"),
      }),
      execute: async ({ subjectId, name, emoji, lecturerName, lecturerContact, practitionerName, practitionerContact }) => {
        console.log("[ai tool] updateSubject:", { subjectId, name, lecturerName, practitionerName });
        const subject = await subjectService.getById(subjectId);
        if (!subject) return { error: "Предмет не найден" };

        const updates = {};
        if (name) updates.name = name;
        if (emoji) updates.emoji = emoji;
        if (lecturerName) updates.lecturerName = lecturerName;
        if (lecturerContact) updates.lecturerContact = lecturerContact;
        if (practitionerName) updates.practitionerName = practitionerName;
        if (practitionerContact) updates.practitionerContact = practitionerContact;

        if (Object.keys(updates).length === 0) {
          return { error: "Нет данных для обновления" };
        }

        const updated = await subjectService.update(subjectId, updates);
        return {
          success: true,
          subjectName: updated.name,
          updatedFields: Object.keys(updates),
        };
      },
    }),

    updateTask: tool({
      description: "Обновить существующее задание: название, описание, эмодзи. Используй когда пользователь просит изменить/отредактировать задание.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания"),
        title: z.string().optional().describe("Новое название"),
        emoji: z.string().optional().describe("Новый эмодзи"),
        description: z.string().optional().describe("Новое описание"),
      }),
      execute: async ({ taskId, title, emoji, description }) => {
        console.log("[ai tool] updateTask:", { taskId, title });
        const updates = {};
        if (title) updates.title = title;
        if (emoji) updates.emoji = emoji;
        if (description) updates.description = description;

        if (Object.keys(updates).length === 0) {
          return { error: "Нет данных для обновления" };
        }

        const result = await subjectService.updateTask(taskId, updates);
        if (!result) return { error: "Задание не найдено" };
        return {
          success: true,
          taskTitle: result.task.title,
          updatedFields: Object.keys(updates),
        };
      },
    }),

    listTasks: tool({
      description: "Получить список заданий предмета. Используй чтобы узнать ID задания перед добавлением ответа, решением или обновлением. Если subjectId не указан — выводит задания ВСЕХ предметов.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета из списка (если не указан — все предметы)"),
      }),
      execute: async ({ subjectId }) => {
        console.log("[ai tool] listTasks:", { subjectId });
        if (subjectId) {
          const subject = await subjectService.getById(subjectId);
          if (!subject) return { error: "Предмет не найден" };
          const mapTask = (t) => ({
            id: t._id.toString(),
            title: t.title,
            emoji: t.emoji || "📄",
            answersCount: t.answers?.length || 0,
            hasAiAnswer: !!t.aiAnswer,
            hasDescription: !!t.description,
            hasAttachments: (t.attachments?.length || 0) > 0,
            deadline: t.deadline ? t.deadline.toISOString() : null,
            submittedCount: (t.submissions || []).filter((s) => s.submitted).length,
            mySubmitted: username ? ((t.submissions || []).find((s) => s.username === username)?.submitted ?? false) : null,
          });
          return {
            tasks: (subject.tasks || []).map(mapTask),
          };
        }
        // All subjects
        const allSubjects = await subjectService.getAll();
        const result = [];
        const mapTask = (t) => ({
          id: t._id.toString(),
          title: t.title,
          emoji: t.emoji || "📄",
          answersCount: t.answers?.length || 0,
          hasAiAnswer: !!t.aiAnswer,
          hasDescription: !!t.description,
          hasAttachments: (t.attachments?.length || 0) > 0,
          deadline: t.deadline ? t.deadline.toISOString() : null,
          submittedCount: (t.submissions || []).filter((s) => s.submitted).length,
          mySubmitted: username ? ((t.submissions || []).find((s) => s.username === username)?.submitted ?? false) : null,
        });
        for (const s of allSubjects) {
          if (!s.tasks || s.tasks.length === 0) continue;
          result.push({
            subjectName: s.name,
            subjectEmoji: s.emoji || "📚",
            subjectId: s._id.toString(),
            tasks: s.tasks.map(mapTask),
          });
        }
        return { subjects: result };
      },
    }),

    getTaskDetails: tool({
      description: "Получить полную информацию о задании: описание, AI-решение, ответы пользователей. Используй когда пользователь просит показать задание, решение, ответы на домашку.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
      }),
      execute: async ({ taskId }) => {
        console.log("[ai tool] getTaskDetails:", { taskId });
        const { subject, task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };
        return {
          taskTitle: task.title,
          taskEmoji: task.emoji || "📄",
          subjectName: subject.name,
          description: task.description || "(нет описания)",
          attachmentsCount: task.attachments?.length || 0,
          deadline: task.deadline ? task.deadline.toISOString() : null,
          aiAnswer: task.aiAnswer || null,
          answers: (task.answers || []).map((a) => ({
            type: a.type,
            content: a.type === "text" ? a.content : `[${a.type}]`,
          })),
          submissions: (task.submissions || []).map((s) => ({
            username: s.username,
            submitted: s.submitted,
          })),
        };
      },
    }),

    addTaskAnswer: tool({
      description: "Добавить текстовый ответ к заданию. Используй когда пользователь присылает решение/ответ на домашку текстом.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        content: z.string().describe("Текст ответа"),
      }),
      execute: async ({ taskId, content }) => {
        console.log("[ai tool] addTaskAnswer:", { taskId, contentLength: content.length });
        const result = await subjectService.addAnswer(taskId, {
          type: "text",
          content,
        });
        if (!result) return { error: "Задание не найдено" };
        return {
          success: true,
          taskTitle: result.task.title,
          answersCount: result.task.answers.length,
        };
      },
    }),

    attachFileToTask: tool({
      description: "Прикрепить файл (document/photo) к условию задания. Используй когда пользователь просит прикрепить файл к заданию/условию. file_id берётся из метаданных [Прикреплённый файл] в сообщении.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        fileId: z.string().describe("Telegram file_id из метаданных сообщения пользователя"),
        fileType: z.enum(["document", "photo"]).describe("Тип файла: document или photo"),
      }),
      execute: async ({ taskId, fileId, fileType }) => {
        console.log("[ai tool] attachFileToTask:", { taskId, fileType });
        const { subject, task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };
        task.attachments.push({ type: fileType, file_id: fileId });
        await subject.save();
        return {
          success: true,
          taskTitle: task.title,
          attachmentsCount: task.attachments.length,
        };
      },
    }),

    addFileAnswer: tool({
      description: "Добавить файл (document/photo) как ответ/решение к заданию. Используй когда пользователь просит прикрепить файл как ответ или решение. file_id берётся из метаданных [Прикреплённый файл] в сообщении.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        fileId: z.string().describe("Telegram file_id из метаданных сообщения пользователя"),
        fileType: z.enum(["document", "photo"]).describe("Тип файла: document или photo"),
      }),
      execute: async ({ taskId, fileId, fileType }) => {
        console.log("[ai tool] addFileAnswer:", { taskId, fileType });
        const result = await subjectService.addAnswer(taskId, {
          type: fileType,
          file_id: fileId,
        });
        if (!result) return { error: "Задание не найдено" };
        return {
          success: true,
          taskTitle: result.task.title,
          answersCount: result.task.answers.length,
        };
      },
    }),

    solveHomework: tool({
      description: "Решить домашнее задание с помощью AI. Сначала вызови listTasks чтобы показать пользователю список заданий и спросить какое решить и какой режим (обычный или PRO). usePro=true для сложных задач (медленнее, но точнее).",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        usePro: z.boolean().optional().describe("true = PRO модель (медленнее но точнее), false = обычная (быстрее). По умолчанию false."),
      }),
      execute: async ({ taskId, usePro = false }) => {
        console.log("[ai tool] solveHomework:", { taskId, usePro });
        const { subject, task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };
        if (!task.description && (!task.attachments || task.attachments.length === 0)) {
          return { error: "У задания нет описания и вложений — нечего решать" };
        }

        const { solveTask } = require("./orchestratorService");
        const { text, files } = await solveTask(task, subject, {
          operationType: "solve",
          feature: "ai-chat-solve",
          entityType: "task",
          entityId: task._id.toString(),
        }, { usePro });

        const update = { aiAnswer: text };
        if (files.length) update.aiAnswerFiles = files;
        await subjectService.updateTask(taskId, update);

        return {
          success: true,
          taskTitle: task.title,
          subjectName: subject.name,
          solution: text,
          hasLatexFile: files.length > 0,
        };
      },
    }),

    getSchedule: tool({
      description: "Получить расписание на определённую дату. Используй когда пользователь спрашивает о расписании на завтра, послезавтра, конкретную дату и т.д. Для сегодняшнего расписания НЕ нужно вызывать — оно уже есть в контексте.",
      inputSchema: z.object({
        date: z.string().describe("Дата в формате YYYY-MM-DD"),
      }),
      execute: async ({ date }) => {
        console.log("[ai tool] getSchedule:", { date });
        const result = await scheduleService.getScheduleForDate(new Date(date));
        return {
          dayName: result.dayName,
          weekNumber: result.weekNumber,
          isOdd: result.isOdd,
          classes: result.classes.map((c) => ({
            slotNumber: c.slotNumber,
            startTime: c.startTime,
            endTime: c.endTime,
            subjectName: c.subjectName || "—",
            subjectEmoji: c.subjectEmoji || "📚",
          })),
        };
      },
    }),

    setTimeSlots: tool({
      description: "Установить тайм-слоты (время начала и конца каждой пары). Вызывай ПЕРВЫМ при настройке расписания. Перезаписывает все слоты.",
      inputSchema: z.object({
        timeSlots: z.array(z.object({
          number: z.number().describe("Номер пары (1, 2, 3...)"),
          startTime: z.string().describe("Время начала (HH:MM)"),
          endTime: z.string().describe("Время конца (HH:MM)"),
        })).describe("Массив тайм-слотов"),
      }),
      execute: async ({ timeSlots }) => {
        console.log("[ai tool] setTimeSlots:", timeSlots.length, "slots");
        await scheduleService.setTimeSlots(timeSlots);
        return { success: true, slotsCount: timeSlots.length };
      },
    }),

    setDaySchedule: tool({
      description: "Установить расписание на один день недели (Пн=1, Вт=2, Ср=3, Чт=4, Пт=5). Привязывает предметы к тайм-слотам. Для мигалок: isAlternating=true, subjectId — нечётная неделя, subjectIdEven — чётная неделя. Пустой слот — не включай в массив.",
      inputSchema: z.object({
        dayOfWeek: z.number().min(1).max(5).describe("День недели: 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт"),
        slots: z.array(z.object({
          slotNumber: z.number().describe("Номер пары (соответствует тайм-слоту)"),
          subjectId: z.string().describe("ID предмета (или ID для нечётной недели при мигалке)"),
          subjectIdEven: z.string().optional().describe("ID предмета для чётной недели (только при isAlternating=true)"),
          isAlternating: z.boolean().optional().describe("true если мигалка (чередование по неделям)"),
        })).describe("Массив слотов с предметами"),
      }),
      execute: async ({ dayOfWeek, slots }) => {
        const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт"];
        console.log("[ai tool] setDaySchedule:", dayNames[dayOfWeek], slots.length, "slots");
        await scheduleService.setDaySchedule(dayOfWeek, slots);
        return { success: true, day: dayNames[dayOfWeek], slotsCount: slots.length };
      },
    }),

    setSaturdayMappings: tool({
      description: "Установить расписание суббот. Каждая суббота (по номеру недели семестра) копирует расписание указанного дня.",
      inputSchema: z.object({
        mappings: z.array(z.object({
          weekNumber: z.number().describe("Номер недели семестра"),
          followsDay: z.number().min(1).max(5).describe("Какой день копирует: 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт"),
        })).describe("Массив маппингов суббот"),
      }),
      execute: async ({ mappings }) => {
        console.log("[ai tool] setSaturdayMappings:", mappings.length, "mappings");
        await scheduleService.setSaturdayMappings(mappings);
        return { success: true, mappingsCount: mappings.length };
      },
    }),

    // --- Трекинг сдачи ---

    markSubmission: tool({
      description: "Отметить сдачу задания (сдал/не сдал). Если targetUsername не указан — отмечает для текущего пользователя.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        targetUsername: z.string().optional().describe("Username студента с @ (если отмечаешь за другого). Если не указан — текущий пользователь."),
        submitted: z.boolean().describe("true = сдал, false = не сдал"),
      }),
      execute: async ({ taskId, targetUsername, submitted }) => {
        const who = targetUsername
          ? (targetUsername.startsWith("@") ? targetUsername : `@${targetUsername}`)
          : username;
        if (!who) return { error: "Не удалось определить пользователя" };
        console.log("[ai tool] markSubmission:", { taskId, who, submitted });
        const { task } = await subjectService.setSubmission(taskId, who, submitted);
        if (!task) return { error: "Задание не найдено" };
        return { success: true, taskTitle: task.title, username: who, submitted };
      },
    }),

    getMySubmissions: tool({
      description: "Показать прогресс текущего пользователя: какие задания сдал, какие нет.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета (если не указан — все предметы)"),
      }),
      execute: async ({ subjectId }) => {
        if (!username) return { error: "Не удалось определить пользователя" };
        console.log("[ai tool] getMySubmissions:", { username, subjectId });
        const subjects = subjectId
          ? [await subjectService.getById(subjectId)].filter(Boolean)
          : await subjectService.getAll();

        return {
          username,
          subjects: subjects.map((s) => ({
            subjectName: s.name,
            subjectEmoji: s.emoji || "📚",
            tasks: (s.tasks || []).map((t) => {
              const sub = (t.submissions || []).find((x) => x.username === username);
              return {
                id: t._id.toString(),
                title: t.title,
                submitted: sub?.submitted ?? false,
                deadline: t.deadline ? t.deadline.toISOString() : null,
              };
            }),
          })),
        };
      },
    }),

    getTaskSubmissions: tool({
      description: "Показать статус сдачи задания по всем студентам.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
      }),
      execute: async ({ taskId }) => {
        console.log("[ai tool] getTaskSubmissions:", { taskId });
        const { task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };
        const userService = require("./userService");
        const allStudents = await userService.getAllUsers();
        const submissionMap = {};
        for (const s of task.submissions || []) submissionMap[s.username] = s.submitted;
        return {
          taskTitle: task.title,
          students: allStudents.map((u) => ({ username: u, submitted: submissionMap[u] ?? false })),
        };
      },
    }),

    // --- Контакты преподавателей ---

    getTeacherInfo: tool({
      description: "Получить контактную информацию преподавателей.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета. Если не указан — все предметы."),
      }),
      execute: async ({ subjectId }) => {
        console.log("[ai tool] getTeacherInfo:", { subjectId });
        if (subjectId) {
          const s = await subjectService.getById(subjectId);
          if (!s) return { error: "Предмет не найден" };
          return {
            subject: s.name,
            lecturer: { name: s.lecturerName || "", contact: s.lecturerContact || "" },
            practitioner: { name: s.practitionerName || "", contact: s.practitionerContact || "" },
          };
        }
        const all = await subjectService.getAll();
        return {
          teachers: all.map((s) => ({
            subject: s.name,
            lecturer: { name: s.lecturerName || "", contact: s.lecturerContact || "" },
            practitioner: { name: s.practitionerName || "", contact: s.practitionerContact || "" },
          })),
        };
      },
    }),

    // --- Дедлайны ---

    setTaskDeadline: tool({
      description: "Установить дедлайн для задания.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        deadline: z.string().describe("Дата дедлайна в формате YYYY-MM-DD или YYYY-MM-DDTHH:mm"),
      }),
      execute: async ({ taskId, deadline }) => {
        console.log("[ai tool] setTaskDeadline:", { taskId, deadline });
        const date = new Date(deadline);
        if (isNaN(date.getTime())) return { error: "Некорректная дата" };
        const result = await subjectService.updateTask(taskId, { deadline: date });
        if (!result) return { error: "Задание не найдено" };
        return { success: true, taskTitle: result.task.title, deadline: date.toISOString() };
      },
    }),

    // --- Голосования ---

    createPoll: tool({
      description: "Создать голосование/опрос в чате группы.",
      inputSchema: z.object({
        question: z.string().describe("Вопрос голосования"),
        options: z.array(z.string()).min(2).max(10).describe("Варианты ответов (2-10)"),
        isAnonymous: z.boolean().optional().describe("Анонимное голосование (по умолчанию true)"),
        allowsMultipleAnswers: z.boolean().optional().describe("Разрешить несколько ответов"),
      }),
      execute: async ({ question, options, isAnonymous = true, allowsMultipleAnswers = false }) => {
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot || !chatId) return { error: "Невозможно отправить — нет доступа к чату" };
        console.log("[ai tool] createPoll:", { question, optionsCount: options.length });
        const msg = await bot.telegram.sendPoll(chatId, question, options, {
          is_anonymous: isAnonymous,
          allows_multiple_answers: allowsMultipleAnswers,
        });
        return { success: true, pollId: msg.poll.id };
      },
    }),
  };

  return { tools, systemPromptAddition, maxSteps: 10 };
}

module.exports = { buildAssistantTools };
