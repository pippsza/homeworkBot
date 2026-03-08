import { tool } from "ai";
import { z } from "zod";
import Info from "../models/Info";
import { debugLog } from "../lib/debugLog";

const subjectService = require("./subjectService");
const infoService = require("./infoService");
const scheduleService = require("./scheduleService");

interface ToolDefinition {
  description: string;
  inputSchema: z.ZodType<any>;
  execute: (args: any) => Promise<any>;
}

interface BuildAssistantToolsParams {
  chatId?: string | number;
  username?: string;
}

interface BuildAssistantToolsResult {
  tools: Record<string, any>;
  systemPromptAddition: string;
  maxSteps: number;
}

/**
 * Wrap a tool execute function with try/catch + debug logging.
 * On error, returns { error: "..." } instead of throwing.
 */
function safeTool(toolName: string, definition: ToolDefinition): any {
  const originalExecute = definition.execute;
  return tool({
    ...definition,
    execute: async (args: any) => {
      try {
        return await originalExecute(args);
      } catch (e: any) {
        debugLog("tool-error", `Tool ${toolName} failed: ${e.message}`, JSON.stringify(args).slice(0, 500));
        return { error: `Ошибка при выполнении ${toolName}: ${e.message}` };
      }
    },
  });
}

/**
 * Build assistant tools and system prompt addition for AI chat.
 * Used by both web API (streaming) and bot (non-streaming).
 */
async function buildAssistantTools({ chatId, username }: BuildAssistantToolsParams = {}): Promise<BuildAssistantToolsResult> {
  const subjects = await subjectService.getAll();
  const subjectsList = subjects
    .map((s: any) => {
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
        (c: any) => `  ${c.slotNumber}. ${c.startTime}-${c.endTime} ${c.subjectEmoji || "📚"} ${c.subjectName || "?"}`
      );
      scheduleContext = `\nРасписание на сегодня (${todaySchedule.dayName}, неделя ${todaySchedule.weekNumber}, ${todaySchedule.isOdd ? "нечётная" : "чётная"}):\n${lines.join("\n")}`;
    } else {
      scheduleContext = `\nСегодня (${todaySchedule.dayName}) нет занятий.`;
    }
  } catch (e: any) {
    debugLog("aiTools-error", `Schedule context error: ${e.message}`);
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
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ОТМЕТИТЬ СДАЧУ/ВЫПОЛНЕНИЕ — вызови markSubmission. Если не указан @username — отмечай текущего пользователя.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "КТО СДАЛ" / "СТАТУС СДАЧИ" — вызови getTaskSubmissions.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "МОЙ ПРОГРЕСС" / "ЧТО Я СДАЛ" — вызови getMySubmissions.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ УСТАНОВИТЬ ДЕДЛАЙН — вызови setTaskDeadline.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ ГОЛОСОВАНИЕ/ОПРОС — вызови createPoll.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ ФАЙЛ И СПРАШИВАЕТ ПО СОДЕРЖИМОМУ — сначала вызови parseDocument чтобы прочитать файл, затем ответь на основе содержимого.
- КОГДА ПОЛЬЗОВАТЕЛЬ ХОЧЕТ НАЙТИ ИНФОРМАЦИЮ В БАЗЕ ЗНАНИЙ — вызови searchKnowledgeBase.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ УДАЛИТЬ ЗАДАНИЕ — вызови deleteTask (только по явной просьбе!).
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ УДАЛИТЬ ПРЕДМЕТ — вызови deleteSubject (предупреди о потере заданий!).
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПОКАЗАТЬ ЗАМЕТКИ — вызови listInfos.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПОКАЗАТЬ ЗАМЕТКУ ПОДРОБНО — вызови getInfoDetails.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ОБНОВИТЬ/ИЗМЕНИТЬ ЗАМЕТКУ — вызови updateInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ УДАЛИТЬ ЗАМЕТКУ — вызови deleteInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ НОМЕР ТЕЛЕФОНА/КОНТАКТ ПРЕПОДАВАТЕЛЯ — вызови getTeacherInfo. Если контакт не указан, так и скажи.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ПРОВЕРИТЬ РАСПИСАНИЕ НА КОНФЛИКТЫ/ОШИБКИ — вызови checkScheduleConflicts.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ СПИСОК ЗАДАНИЙ (из файла или текстом) И ПРОСИТ СОЗДАТЬ ИХ ВСЕ — сначала parseDocument (если файл), затем вызови bulkCreateTasks с массивом заданий. Не создавай по одному через createHomework.
- КОГДА ПОЛЬЗОВАТЕЛЬ ЗАГРУЖАЕТ ФАЙЛ С РАСПИСАНИЕМ — вызови parseDocument, разбери структуру (дни, пары, предметы, время), затем вызови importScheduleFromText. Предметы которых нет в списке будут созданы автоматически.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ЗАПОЛНИТЬ/НАСТРОИТЬ РАСПИСАНИЕ ТЕКСТОМ — вызови importScheduleFromText. Не нужно вызывать setTimeSlots + setDaySchedule по отдельности.
- НИКОГДА не отвечай текстом "я сделал" без реального вызова инструмента.
- ПОСЛЕ КАЖДОГО ВЫЗОВА ИНСТРУМЕНТА ОБЯЗАТЕЛЬНО напиши текстовый ответ пользователю с результатами. НИКОГДА не завершай ответ только вызовом инструмента без текста.
  Примеры правильных ответов после вызова инструмента:
  * markSubmission -> "Отметил: ты сдал Лабу 1 по криптографии ✅"
  * getTaskSubmissions -> "Лаба 1 по криптографии:\n✅ @ivan — сдал\n❌ @peter — не сдал"
  * getMySubmissions -> "Твой прогресс:\n✅ Лаба 1 — сдано\n❌ Лаба 2 — не сдано"
  * createHomework -> "Создал задание «Лаба 2» в предмете Криптография 🔐"
  * listTasks -> перечисли задания в читаемом виде
- ВСЕГДА отвечай на русском языке развёрнуто и по делу. Не пиши просто "Готово" — опиши что было сделано или покажи запрошенные данные.

КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ "ЧТО ТЫ УМЕЕШЬ" / "КАКИЕ ВОЗМОЖНОСТИ" / "ПОМОЩЬ" / "ЧТО МОЖНО ДЕЛАТЬ" — расскажи подробно, разделив на интерфейс и чат. Используй информацию ниже.

ВОЗМОЖНОСТИ БОТА — ИНТЕРФЕЙС (кнопки и меню):
- Просмотр и управление предметами с эмодзи
- Добавление и просмотр домашних заданий
- Сохранение и просмотр информации/заметок
- Настройка модели AI через Mini App
- Прикрепление файлов (документы, фото) к заданиям и заметкам

ВОЗМОЖНОСТИ БОТА — ЧАТ с AI:
- Создание предметов: "добавь предмет Криптография 🔐"
- Создание заданий: "добавь домашку по матану: интегралы стр 45"
- Запоминание информации: "запомни: зачёт по физике 15 января"
- Обновление данных: "лектор по матану — Иванов И.И."
- AI-решение заданий: "реши домашку по криптографии" (обычный и PRO режимы)
- Просмотр расписания: "что завтра?" / "расписание на среду"
- Настройка расписания: "настрой расписание: пн — матан, физика; вт — ..."
- Трекинг сдачи: "я сдал лабу 1" / "кто сдал лабу?" / "мой прогресс"
- Дедлайны: "дедлайн лабы 1 — 20 марта"
- Массовое создание заданий: отправить список -> AI создаст все задания сразу
- Импорт расписания: отправить PDF/фото расписания -> AI заполнит всё автоматически
- Создание голосований: "создай опрос: куда идём на обед?"
- Анализ фото и документов: отправить фото/файл -> AI проанализирует содержимое (поддержка нескольких фото сразу)
- Парсинг документов: PDF, DOCX, TXT файлы автоматически читаются и анализируются
- Поиск по базе знаний: AI ищет релевантную информацию в векторной БД
- Управление заметками: просмотр, обновление, удаление сохранённой информации
- Удаление заданий и предметов через чат

АВТОМАТИЧЕСКИЕ УВЕДОМЛЕНИЯ:
- Напоминания о дедлайнах (за 24ч и 1ч)
- Уведомления о начале пар (за 10 мин)
- Еженедельный дайджест по понедельникам в 08:00`;

  const tools: Record<string, any> = {
    createSubject: safeTool("createSubject", {
      description: "Создать новый предмет. Используй когда пользователь просит добавить предмет или когда настраиваешь расписание и нужного предмета нет в списке.",
      inputSchema: z.object({
        name: z.string().describe("Название предмета"),
        emoji: z.string().optional().describe("Эмодзи для предмета (по умолчанию 📚)"),
        lecturerName: z.string().optional().describe("ФИО лектора"),
        practitionerName: z.string().optional().describe("ФИО практика"),
      }),
      execute: async ({ name, emoji, lecturerName, practitionerName }: { name: string; emoji?: string; lecturerName?: string; practitionerName?: string }) => {
        debugLog("tool", `createSubject: ${name}`);
        const data: Record<string, string> = { name, emoji: emoji || "📚" };
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

    createHomework: safeTool("createHomework", {
      description: "Создать домашнее задание. Используй когда пользователь просит создать, добавить домашку или задание.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета из списка доступных предметов"),
        title: z.string().describe("Название задания (краткое, 5-15 слов)"),
        emoji: z.string().optional().describe("Эмодзи для задания (по умолчанию 📄)"),
        description: z.string().describe("Полное описание задания"),
      }),
      execute: async ({ subjectId, title, emoji, description }: { subjectId: string; title: string; emoji?: string; description: string }) => {
        debugLog("tool", `createHomework: ${title} (subject: ${subjectId})`);
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

    rememberInfo: safeTool("rememberInfo", {
      description: "Запомнить информацию. Используй когда пользователь просит запомнить, сохранить, записать какую-то информацию или факт.",
      inputSchema: z.object({
        title: z.string().describe("Краткий заголовок (3-10 слов)"),
        emoji: z.string().optional().describe("Подходящий emoji (по умолчанию ℹ️)"),
        description: z.string().describe("Полный текст информации для запоминания"),
      }),
      execute: async ({ title, emoji, description }: { title: string; emoji?: string; description: string }) => {
        debugLog("tool", `rememberInfo: ${title}`);
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

    updateSubject: safeTool("updateSubject", {
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
      execute: async ({ subjectId, name, emoji, lecturerName, lecturerContact, practitionerName, practitionerContact }: { subjectId: string; name?: string; emoji?: string; lecturerName?: string; lecturerContact?: string; practitionerName?: string; practitionerContact?: string }) => {
        debugLog("tool", `updateSubject: ${subjectId}`, { name, lecturerName, practitionerName });
        const subject = await subjectService.getById(subjectId);
        if (!subject) return { error: "Предмет не найден" };

        const updates: Record<string, string> = {};
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

    updateTask: safeTool("updateTask", {
      description: "Обновить существующее задание: название, описание, эмодзи. Используй когда пользователь просит изменить/отредактировать задание.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания"),
        title: z.string().optional().describe("Новое название"),
        emoji: z.string().optional().describe("Новый эмодзи"),
        description: z.string().optional().describe("Новое описание"),
      }),
      execute: async ({ taskId, title, emoji, description }: { taskId: string; title?: string; emoji?: string; description?: string }) => {
        debugLog("tool", `updateTask: ${taskId}`, { title });
        const updates: Record<string, string> = {};
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

    listTasks: safeTool("listTasks", {
      description: "Получить список заданий предмета. Используй чтобы узнать ID задания перед добавлением ответа, решением или обновлением. Если subjectId не указан — выводит задания ВСЕХ предметов.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета из списка (если не указан — все предметы)"),
      }),
      execute: async ({ subjectId }: { subjectId?: string }) => {
        debugLog("tool", `listTasks: subjectId=${subjectId || "all"}`);
        const mapTask = (t: any) => ({
          id: t._id.toString(),
          title: t.title,
          emoji: t.emoji || "📄",
          description: t.description || null,
          deadline: t.deadline ? t.deadline.toISOString() : null,
          hasAttachments: (t.attachments?.length || 0) > 0,
          aiAnswer: t.aiAnswer ? t.aiAnswer.slice(0, 500) : null,
          answers: (t.answers || []).map((a: any) => ({
            type: a.type,
            content: a.type === "text" ? a.content?.slice(0, 300) : `[${a.type}]`,
          })),
          submittedCount: (t.submissions || []).filter((s: any) => s.submitted).length,
          mySubmitted: username ? ((t.submissions || []).find((s: any) => s.username === username)?.submitted ?? false) : null,
        });
        if (subjectId) {
          const subject = await subjectService.getById(subjectId);
          if (!subject) return { error: "Предмет не найден" };
          return {
            tasks: (subject.tasks || []).map(mapTask),
          };
        }
        // All subjects
        const allSubjects = await subjectService.getAll();
        const result: any[] = [];
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

    getTaskDetails: safeTool("getTaskDetails", {
      description: "Получить полную информацию о задании: описание, AI-решение, ответы пользователей. Используй когда пользователь просит показать задание, решение, ответы на домашку.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
      }),
      execute: async ({ taskId }: { taskId: string }) => {
        debugLog("tool", `getTaskDetails: ${taskId}`);
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
          answers: (task.answers || []).map((a: any) => ({
            type: a.type,
            content: a.type === "text" ? a.content : `[${a.type}]`,
          })),
          submissions: (task.submissions || []).map((s: any) => ({
            username: s.username,
            submitted: s.submitted,
          })),
        };
      },
    }),

    addTaskAnswer: safeTool("addTaskAnswer", {
      description: "Добавить текстовый ответ к заданию. Используй когда пользователь присылает решение/ответ на домашку текстом.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        content: z.string().describe("Текст ответа"),
      }),
      execute: async ({ taskId, content }: { taskId: string; content: string }) => {
        debugLog("tool", `addTaskAnswer: ${taskId} (${content.length} chars)`);
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

    attachFileToTask: safeTool("attachFileToTask", {
      description: "Прикрепить файл (document/photo) к условию задания. Используй когда пользователь просит прикрепить файл к заданию/условию. file_id берётся из метаданных [Прикреплённый файл] в сообщении.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        fileId: z.string().describe("Telegram file_id из метаданных сообщения пользователя"),
        fileType: z.enum(["document", "photo"]).describe("Тип файла: document или photo"),
      }),
      execute: async ({ taskId, fileId, fileType }: { taskId: string; fileId: string; fileType: "document" | "photo" }) => {
        debugLog("tool", `attachFileToTask: ${taskId} (${fileType})`);
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

    addFileAnswer: safeTool("addFileAnswer", {
      description: "Добавить файл (document/photo) как ответ/решение к заданию. Используй когда пользователь просит прикрепить файл как ответ или решение. file_id берётся из метаданных [Прикреплённый файл] в сообщении.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        fileId: z.string().describe("Telegram file_id из метаданных сообщения пользователя"),
        fileType: z.enum(["document", "photo"]).describe("Тип файла: document или photo"),
      }),
      execute: async ({ taskId, fileId, fileType }: { taskId: string; fileId: string; fileType: "document" | "photo" }) => {
        debugLog("tool", `addFileAnswer: ${taskId} (${fileType})`);
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

    solveHomework: safeTool("solveHomework", {
      description: "Решить домашнее задание с помощью AI. Сначала вызови listTasks чтобы показать пользователю список заданий и спросить какое решить и какой режим (обычный или PRO). usePro=true для сложных задач (медленнее, но точнее).",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        usePro: z.boolean().optional().describe("true = PRO модель (медленнее но точнее), false = обычная (быстрее). По умолчанию false."),
      }),
      execute: async ({ taskId, usePro = false }: { taskId: string; usePro?: boolean }) => {
        debugLog("tool", `solveHomework: ${taskId} (pro: ${usePro})`);
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

        const update: Record<string, any> = { aiAnswer: text };
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

    getSchedule: safeTool("getSchedule", {
      description: "Получить расписание на определённую дату. Используй когда пользователь спрашивает о расписании на завтра, послезавтра, конкретную дату и т.д. Для сегодняшнего расписания НЕ нужно вызывать — оно уже есть в контексте.",
      inputSchema: z.object({
        date: z.string().describe("Дата в формате YYYY-MM-DD"),
      }),
      execute: async ({ date }: { date: string }) => {
        debugLog("tool", `getSchedule: ${date}`);
        const result = await scheduleService.getScheduleForDate(new Date(date));
        return {
          dayName: result.dayName,
          weekNumber: result.weekNumber,
          isOdd: result.isOdd,
          classes: result.classes.map((c: any) => ({
            slotNumber: c.slotNumber,
            startTime: c.startTime,
            endTime: c.endTime,
            subjectName: c.subjectName || "—",
            subjectEmoji: c.subjectEmoji || "📚",
          })),
        };
      },
    }),

    setTimeSlots: safeTool("setTimeSlots", {
      description: "Установить тайм-слоты (время начала и конца каждой пары). Вызывай ПЕРВЫМ при настройке расписания. Перезаписывает все слоты.",
      inputSchema: z.object({
        timeSlots: z.array(z.object({
          number: z.number().describe("Номер пары (1, 2, 3...)"),
          startTime: z.string().describe("Время начала (HH:MM)"),
          endTime: z.string().describe("Время конца (HH:MM)"),
        })).describe("Массив тайм-слотов"),
      }),
      execute: async ({ timeSlots }: { timeSlots: Array<{ number: number; startTime: string; endTime: string }> }) => {
        debugLog("tool", `setTimeSlots: ${timeSlots.length} slots`);
        await scheduleService.setTimeSlots(timeSlots);
        return { success: true, slotsCount: timeSlots.length };
      },
    }),

    setDaySchedule: safeTool("setDaySchedule", {
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
      execute: async ({ dayOfWeek, slots }: { dayOfWeek: number; slots: Array<{ slotNumber: number; subjectId: string; subjectIdEven?: string; isAlternating?: boolean }> }) => {
        const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт"];
        debugLog("tool", `setDaySchedule: ${dayNames[dayOfWeek]} ${slots.length} slots`);
        await scheduleService.setDaySchedule(dayOfWeek, slots);
        return { success: true, day: dayNames[dayOfWeek], slotsCount: slots.length };
      },
    }),

    setSaturdayMappings: safeTool("setSaturdayMappings", {
      description: "Установить расписание суббот. Каждая суббота (по номеру недели семестра) копирует расписание указанного дня.",
      inputSchema: z.object({
        mappings: z.array(z.object({
          weekNumber: z.number().describe("Номер недели семестра"),
          followsDay: z.number().min(1).max(5).describe("Какой день копирует: 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт"),
        })).describe("Массив маппингов суббот"),
      }),
      execute: async ({ mappings }: { mappings: Array<{ weekNumber: number; followsDay: number }> }) => {
        debugLog("tool", `setSaturdayMappings: ${mappings.length} mappings`);
        await scheduleService.setSaturdayMappings(mappings);
        return { success: true, mappingsCount: mappings.length };
      },
    }),

    // --- Трекинг сдачи ---

    markSubmission: safeTool("markSubmission", {
      description: "Отметить сдачу задания (сдал/не сдал). Если targetUsername не указан — отмечает для текущего пользователя.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        targetUsername: z.string().optional().describe("Username студента с @ (если отмечаешь за другого). Если не указан — текущий пользователь."),
        submitted: z.boolean().describe("true = сдал, false = не сдал"),
      }),
      execute: async ({ taskId, targetUsername, submitted }: { taskId: string; targetUsername?: string; submitted: boolean }) => {
        const who = targetUsername
          ? (targetUsername.startsWith("@") ? targetUsername : `@${targetUsername}`)
          : username;
        if (!who) return { error: "Не удалось определить пользователя" };
        debugLog("tool", `markSubmission: ${taskId} ${who} → ${submitted}`);
        const { task } = await subjectService.setSubmission(taskId, who, submitted);
        if (!task) return { error: "Задание не найдено" };
        return { success: true, taskTitle: task.title, username: who, submitted };
      },
    }),

    getMySubmissions: safeTool("getMySubmissions", {
      description: "Показать прогресс текущего пользователя: какие задания сдал, какие нет.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета (если не указан — все предметы)"),
      }),
      execute: async ({ subjectId }: { subjectId?: string }) => {
        if (!username) return { error: "Не удалось определить пользователя" };
        debugLog("tool", `getMySubmissions: ${username} subjectId=${subjectId || "all"}`);
        const subjectsResult = subjectId
          ? [await subjectService.getById(subjectId)].filter(Boolean)
          : await subjectService.getAll();

        return {
          username,
          subjects: subjectsResult.map((s: any) => ({
            subjectName: s.name,
            subjectEmoji: s.emoji || "📚",
            tasks: (s.tasks || []).map((t: any) => {
              const sub = (t.submissions || []).find((x: any) => x.username === username);
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

    getTaskSubmissions: safeTool("getTaskSubmissions", {
      description: "Показать статус сдачи задания по всем студентам.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
      }),
      execute: async ({ taskId }: { taskId: string }) => {
        debugLog("tool", `getTaskSubmissions: ${taskId}`);
        const { task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };
        const userService = require("./userService");
        const allStudents: string[] = await userService.getAllUsers();
        const submissionMap: Record<string, boolean> = {};
        for (const s of task.submissions || []) submissionMap[s.username] = s.submitted;
        return {
          taskTitle: task.title,
          students: allStudents.map((u: string) => ({ username: u, submitted: submissionMap[u] ?? false })),
        };
      },
    }),

    // --- Контакты преподавателей ---

    getTeacherInfo: safeTool("getTeacherInfo", {
      description: "Получить контактную информацию преподавателей.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета. Если не указан — все предметы."),
      }),
      execute: async ({ subjectId }: { subjectId?: string }) => {
        debugLog("tool", `getTeacherInfo: subjectId=${subjectId || "all"}`);
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
          teachers: all.map((s: any) => ({
            subject: s.name,
            lecturer: { name: s.lecturerName || "", contact: s.lecturerContact || "" },
            practitioner: { name: s.practitionerName || "", contact: s.practitionerContact || "" },
          })),
        };
      },
    }),

    // --- Дедлайны ---

    setTaskDeadline: safeTool("setTaskDeadline", {
      description: "Установить дедлайн для задания.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        deadline: z.string().describe("Дата дедлайна в формате YYYY-MM-DD или YYYY-MM-DDTHH:mm"),
      }),
      execute: async ({ taskId, deadline }: { taskId: string; deadline: string }) => {
        debugLog("tool", `setTaskDeadline: ${taskId} → ${deadline}`);
        const date = new Date(deadline);
        if (isNaN(date.getTime())) return { error: "Некорректная дата" };
        const result = await subjectService.updateTask(taskId, { deadline: date });
        if (!result) return { error: "Задание не найдено" };
        return { success: true, taskTitle: result.task.title, deadline: date.toISOString() };
      },
    }),

    // --- Голосования ---

    createPoll: safeTool("createPoll", {
      description: "Создать голосование/опрос в чате группы.",
      inputSchema: z.object({
        question: z.string().describe("Вопрос голосования"),
        options: z.array(z.string()).min(2).max(10).describe("Варианты ответов (2-10)"),
        isAnonymous: z.boolean().optional().describe("Анонимное голосование (по умолчанию true)"),
        allowsMultipleAnswers: z.boolean().optional().describe("Разрешить несколько ответов"),
      }),
      execute: async ({ question, options, isAnonymous = true, allowsMultipleAnswers = false }: { question: string; options: string[]; isAnonymous?: boolean; allowsMultipleAnswers?: boolean }) => {
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot || !chatId) return { error: "Невозможно отправить — нет доступа к чату" };
        debugLog("tool", `createPoll: ${question} (${options.length} options)`);
        const msg = await bot.telegram.sendPoll(chatId, question, options, {
          is_anonymous: isAnonymous,
          allows_multiple_answers: allowsMultipleAnswers,
        });
        return { success: true, pollId: msg.poll.id };
      },
    }),

    // --- Парсинг документов ---

    parseDocument: safeTool("parseDocument", {
      description: "Скачать и распарсить файл по Telegram file_id. Поддерживает PDF, DOCX, TXT и другие текстовые файлы. Используй когда нужно прочитать содержимое файла — например для решения задания из файла.",
      inputSchema: z.object({
        fileId: z.string().describe("Telegram file_id из метаданных [Прикреплённый файл]"),
        fileName: z.string().optional().describe("Имя файла (для определения типа)"),
      }),
      execute: async ({ fileId, fileName }: { fileId: string; fileName?: string }) => {
        debugLog("tool", `parseDocument: ${fileName || fileId}`);
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot) return { error: "Нет доступа к боту" };

        const url = await bot.telegram.getFileLink(fileId);
        const res = await fetch(url.href);
        const buffer = Buffer.from(await res.arrayBuffer());

        const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
        const binaryExts = new Set(["zip", "rar", "7z", "gz", "tar", "exe", "dll", "bin", "iso", "img", "mp3", "mp4", "avi", "mov", "wav", "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "psd", "ai", "sketch", "xls", "xlsx", "ppt", "pptx", "odt", "ods"]);

        if (binaryExts.has(ext)) {
          return { error: `Файл "${fileName}" имеет формат .${ext}, который не поддерживается для текстового парсинга. Поддерживаемые форматы: PDF, DOCX, TXT и другие текстовые файлы.` };
        }

        let text = "";

        if (ext === "pdf") {
          const { PDFParse } = require("pdf-parse");
          const parser = new PDFParse({ data: buffer });
          await parser.load();
          text = await parser.getText();
        } else if (ext === "docx") {
          const mammoth = require("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        } else {
          // Try as plain text — check for binary content
          text = buffer.toString("utf-8");
          const nullBytes = (text.match(/\0/g) || []).length;
          if (nullBytes > text.length * 0.01) {
            return { error: `Файл "${fileName}" содержит бинарные данные и не может быть прочитан как текст.` };
          }
        }

        // Truncate if very long
        const maxChars = 15000;
        const truncated = text.length > maxChars;
        return {
          success: true,
          text: truncated ? text.slice(0, maxChars) : text,
          truncated,
          totalLength: text.length,
          fileName: fileName || "file",
        };
      },
    }),

    // --- Поиск по базе знаний ---

    searchKnowledgeBase: safeTool("searchKnowledgeBase", {
      description: "Поиск по векторной базе знаний (Qdrant). Ищет релевантные материалы по запросу. Используй когда пользователь спрашивает по учебным материалам, конспектам и т.д.",
      inputSchema: z.object({
        query: z.string().describe("Поисковый запрос"),
        subjectId: z.string().optional().describe("ID предмета (если не указан — ищет по общей базе)"),
      }),
      execute: async ({ query, subjectId }: { query: string; subjectId?: string }) => {
        debugLog("tool", `searchKnowledgeBase: "${query}" subjectId=${subjectId || "general"}`);
        const embeddingService = require("./embeddingService");
        const qdrantService = require("./qdrantService");

        const embedding = await embeddingService.embedText(query);
        let results: any[] = [];

        if (subjectId) {
          results = await qdrantService.search(subjectId, embedding, 5);
        }
        const generalResults = await qdrantService.searchGeneral(embedding, 5);
        const allResults = [...results, ...generalResults]
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 7);

        if (allResults.length === 0) {
          return { found: false, message: "Ничего не найдено в базе знаний" };
        }

        return {
          found: true,
          results: allResults.map((r: any) => ({
            text: r.text,
            score: r.score,
          })),
        };
      },
    }),

    // --- Удаление ---

    deleteTask: safeTool("deleteTask", {
      description: "Удалить задание. Используй ТОЛЬКО когда пользователь ЯВНО просит удалить задание.",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
      }),
      execute: async ({ taskId }: { taskId: string }) => {
        debugLog("tool", `deleteTask: ${taskId}`);
        const result = await subjectService.deleteTask(taskId);
        if (!result) return { error: "Задание не найдено" };
        return { success: true, deletedTitle: result.title, subjectName: result.subject.name };
      },
    }),

    deleteSubject: safeTool("deleteSubject", {
      description: "Удалить предмет со ВСЕМИ заданиями. Используй ТОЛЬКО когда пользователь ЯВНО просит удалить предмет. Предупреди что все задания будут потеряны.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета"),
      }),
      execute: async ({ subjectId }: { subjectId: string }) => {
        debugLog("tool", `deleteSubject: ${subjectId}`);
        const subject = await subjectService.getById(subjectId);
        if (!subject) return { error: "Предмет не найден" };
        const tasksCount = subject.tasks?.length || 0;
        await subjectService.delete(subjectId);
        return { success: true, deletedName: subject.name, tasksDeleted: tasksCount };
      },
    }),

    // --- Информация ---

    listInfos: safeTool("listInfos", {
      description: "Показать все сохранённые заметки/информацию.",
      inputSchema: z.object({}),
      execute: async () => {
        debugLog("tool", "listInfos");
        const infos = await infoService.getAll();
        return {
          infos: infos.map((i: any) => ({
            id: i._id.toString(),
            title: i.title,
            emoji: i.emoji || "ℹ️",
            description: (i.description || "").slice(0, 200),
            hasAttachments: (i.attachments?.length || 0) > 0,
          })),
        };
      },
    }),

    getInfoDetails: safeTool("getInfoDetails", {
      description: "Получить полную информацию о заметке по ID.",
      inputSchema: z.object({
        infoId: z.string().describe("ID заметки (получи через listInfos)"),
      }),
      execute: async ({ infoId }: { infoId: string }) => {
        debugLog("tool", `getInfoDetails: ${infoId}`);
        const info = await infoService.getById(infoId);
        if (!info) return { error: "Заметка не найдена" };
        return {
          title: info.title,
          emoji: info.emoji || "ℹ️",
          description: info.description || "(пусто)",
          attachmentsCount: info.attachments?.length || 0,
        };
      },
    }),

    updateInfo: safeTool("updateInfo", {
      description: "Обновить существующую заметку.",
      inputSchema: z.object({
        infoId: z.string().describe("ID заметки"),
        title: z.string().optional().describe("Новый заголовок"),
        emoji: z.string().optional().describe("Новый эмодзи"),
        description: z.string().optional().describe("Новое описание"),
      }),
      execute: async ({ infoId, title, emoji, description }: { infoId: string; title?: string; emoji?: string; description?: string }) => {
        debugLog("tool", `updateInfo: ${infoId}`);
        const updates: Record<string, string> = {};
        if (title) updates.title = title;
        if (emoji) updates.emoji = emoji;
        if (description) updates.description = description;
        if (Object.keys(updates).length === 0) return { error: "Нет данных для обновления" };
        const info = await infoService.update(infoId, updates);
        if (!info) return { error: "Заметка не найдена" };
        return { success: true, infoTitle: info.title };
      },
    }),

    deleteInfo: safeTool("deleteInfo", {
      description: "Удалить заметку. Используй ТОЛЬКО когда пользователь ЯВНО просит удалить.",
      inputSchema: z.object({
        infoId: z.string().describe("ID заметки"),
      }),
      execute: async ({ infoId }: { infoId: string }) => {
        debugLog("tool", `deleteInfo: ${infoId}`);
        const info = await infoService.getById(infoId);
        if (!info) return { error: "Заметка не найдена" };
        await infoService.delete(infoId);
        return { success: true, deletedTitle: info.title };
      },
    }),

    // --- Проверка конфликтов расписания ---

    checkScheduleConflicts: safeTool("checkScheduleConflicts", {
      description: "Проверить конфликты в расписании: пересечения пар, дублирование предметов в одном слоте. Вызывай когда пользователь просит проверить расписание на ошибки или конфликты.",
      inputSchema: z.object({}),
      execute: async () => {
        debugLog("tool", "checkScheduleConflicts");
        const doc = await scheduleService.get();
        const conflicts: string[] = [];

        // Check each day for duplicate slot numbers
        const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт"];
        for (const day of doc.days || []) {
          const slotNums: number[] = day.slots.map((s: any) => s.slotNumber);
          const dups = slotNums.filter((n: number, i: number) => slotNums.indexOf(n) !== i);
          if (dups.length > 0) {
            conflicts.push(`${dayNames[day.dayOfWeek]}: дублирующиеся слоты #${[...new Set(dups)].join(", #")}`);
          }
        }

        // Check time slots for overlaps
        const sorted = [...(doc.timeSlots || [])].sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].endTime > sorted[i + 1].startTime) {
            conflicts.push(`Тайм-слоты #${sorted[i].number} (${sorted[i].startTime}-${sorted[i].endTime}) и #${sorted[i + 1].number} (${sorted[i + 1].startTime}-${sorted[i + 1].endTime}) пересекаются`);
          }
        }

        // Check for slots referencing non-existent time slots
        const validSlotNums = new Set((doc.timeSlots || []).map((t: any) => t.number));
        for (const day of doc.days || []) {
          for (const slot of day.slots) {
            if (!validSlotNums.has(slot.slotNumber)) {
              conflicts.push(`${dayNames[day.dayOfWeek]}: слот #${slot.slotNumber} не имеет тайм-слота`);
            }
          }
        }

        // Check for alternating slots missing even subject
        for (const day of doc.days || []) {
          for (const slot of day.slots) {
            if (slot.isAlternating && !slot.subjectIdEven) {
              conflicts.push(`${dayNames[day.dayOfWeek]}: слот #${slot.slotNumber} — мигалка без предмета для чётной недели`);
            }
          }
        }

        if (conflicts.length === 0) {
          return { hasConflicts: false, message: "Конфликтов не найдено. Расписание корректно." };
        }
        return { hasConflicts: true, conflicts };
      },
    }),

    // --- Массовое создание заданий ---

    bulkCreateTasks: safeTool("bulkCreateTasks", {
      description: "Создать несколько заданий сразу для одного предмета. Используй когда пользователь присылает список заданий (из файла или текстом) и просит создать их все. Сначала распарси документ через parseDocument если задания в файле.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета"),
        tasks: z.array(z.object({
          title: z.string().describe("Название задания"),
          emoji: z.string().optional().describe("Эмодзи"),
          description: z.string().optional().describe("Описание задания"),
          deadline: z.string().optional().describe("Дедлайн (YYYY-MM-DD)"),
        })).describe("Массив заданий для создания"),
      }),
      execute: async ({ subjectId, tasks }: { subjectId: string; tasks: Array<{ title: string; emoji?: string; description?: string; deadline?: string }> }) => {
        debugLog("tool", `bulkCreateTasks: ${subjectId} (${tasks.length} tasks)`);
        const subject = await subjectService.getById(subjectId);
        if (!subject) return { error: "Предмет не найден" };

        const created: Array<{ id: string; title: string }> = [];
        for (const t of tasks) {
          const task = await subjectService.addTask(subjectId, {
            title: t.title,
            emoji: t.emoji || "📄",
            description: t.description || "",
          });
          if (t.deadline) {
            const date = new Date(t.deadline);
            if (!isNaN(date.getTime())) {
              await subjectService.updateTask(task._id.toString(), { deadline: date });
            }
          }
          created.push({ id: task._id.toString(), title: t.title });
        }

        return {
          success: true,
          subjectName: subject.name,
          createdCount: created.length,
          tasks: created,
        };
      },
    }),

    // --- Импорт расписания из текста ---

    importScheduleFromText: safeTool("importScheduleFromText", {
      description: "Импортировать расписание из структурированного текста. Парсит тайм-слоты и расписание по дням. Используй после parseDocument когда пользователь загружает файл с расписанием. Передай ВЕСЬ текст расписания — инструмент сам разберёт структуру и заполнит расписание. Предметы будут автоматически созданы если их нет в списке.",
      inputSchema: z.object({
        timeSlots: z.array(z.object({
          number: z.number().describe("Номер пары"),
          startTime: z.string().describe("Время начала (HH:MM)"),
          endTime: z.string().describe("Время конца (HH:MM)"),
        })).optional().describe("Тайм-слоты (если известны). Если не указаны — текущие сохранятся."),
        days: z.array(z.object({
          dayOfWeek: z.number().min(1).max(5).describe("1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт"),
          slots: z.array(z.object({
            slotNumber: z.number().describe("Номер пары"),
            subjectName: z.string().describe("Название предмета"),
            subjectNameEven: z.string().optional().describe("Предмет для чётной недели (если мигалка)"),
          })),
        })).describe("Расписание по дням"),
      }),
      execute: async ({ timeSlots, days }: { timeSlots?: Array<{ number: number; startTime: string; endTime: string }>; days: Array<{ dayOfWeek: number; slots: Array<{ slotNumber: number; subjectName: string; subjectNameEven?: string }> }> }) => {
        debugLog("tool", `importScheduleFromText: ${timeSlots?.length || 0} slots, ${days.length} days`);

        // Set time slots if provided
        if (timeSlots && timeSlots.length > 0) {
          await scheduleService.setTimeSlots(timeSlots);
        }

        // Resolve subject names to IDs, creating new subjects if needed
        const allSubjects = await subjectService.getAll();
        const nameToId = new Map<string, string>();
        for (const s of allSubjects) {
          nameToId.set(s.name.toLowerCase(), s._id.toString());
        }

        const createdSubjects: string[] = [];

        async function resolveSubjectId(name: string | undefined): Promise<string | null> {
          if (!name) return null;
          const lower = name.toLowerCase();
          if (nameToId.has(lower)) return nameToId.get(lower)!;
          // Create new subject
          const newSubject = await subjectService.create({ name, emoji: "📚" });
          const id = newSubject._id.toString();
          nameToId.set(lower, id);
          createdSubjects.push(name);
          return id;
        }

        const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт"];
        const results: Array<{ day: string; slotsCount: number }> = [];

        for (const day of days) {
          const slots: Array<{ slotNumber: number; subjectId: string; subjectIdEven?: string; isAlternating?: boolean }> = [];
          for (const slot of day.slots) {
            const subjectId = await resolveSubjectId(slot.subjectName);
            if (!subjectId) continue;

            const entry: { slotNumber: number; subjectId: string; subjectIdEven?: string; isAlternating?: boolean } = { slotNumber: slot.slotNumber, subjectId };
            if (slot.subjectNameEven) {
              entry.subjectIdEven = await resolveSubjectId(slot.subjectNameEven) || undefined;
              entry.isAlternating = true;
            }
            slots.push(entry);
          }
          await scheduleService.setDaySchedule(day.dayOfWeek, slots);
          results.push({ day: dayNames[day.dayOfWeek], slotsCount: slots.length });
        }

        return {
          success: true,
          daysSet: results,
          createdSubjects: createdSubjects.length > 0 ? createdSubjects : undefined,
        };
      },
    }),

    // --- Отправка файлов в чат ---

    sendMessageToChat: safeTool("sendMessageToChat", {
      description: "Отправить сообщение в чат группы (не текущему пользователю, а именно в чат группы). Используй для уведомлений, напоминаний группе.",
      inputSchema: z.object({
        text: z.string().describe("Текст сообщения"),
      }),
      execute: async ({ text }: { text: string }) => {
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot || !chatId) return { error: "Нет доступа к чату" };
        debugLog("tool", `sendMessageToChat: ${text.slice(0, 50)}`);
        await bot.telegram.sendMessage(chatId, text);
        return { success: true };
      },
    }),

    forwardFileToChat: safeTool("forwardFileToChat", {
      description: "Переслать файл/фото в чат по file_id. Используй когда нужно отправить файл из задания в чат.",
      inputSchema: z.object({
        fileId: z.string().describe("Telegram file_id"),
        fileType: z.enum(["document", "photo"]).describe("Тип: document или photo"),
        caption: z.string().optional().describe("Подпись к файлу"),
      }),
      execute: async ({ fileId, fileType, caption }: { fileId: string; fileType: "document" | "photo"; caption?: string }) => {
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot || !chatId) return { error: "Нет доступа к чату" };
        debugLog("tool", `forwardFileToChat: ${fileType}`);
        if (fileType === "photo") {
          await bot.telegram.sendPhoto(chatId, fileId, { caption });
        } else {
          await bot.telegram.sendDocument(chatId, fileId, { caption });
        }
        return { success: true };
      },
    }),
  };

  return { tools, systemPromptAddition, maxSteps: 15 };
}

export { buildAssistantTools };
