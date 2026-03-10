import { tool } from "ai";
import { z } from "zod";
import Info from "../models/Info";
import { debugLog } from "../lib/debugLog";

const subjectService = require("./subjectService");
const infoService = require("./infoService");
const scheduleService = require("./scheduleService");
const reminderService = require("./reminderService");

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

  const systemPromptAddition = `

Ты — AI-ассистент учебного бота. У тебя есть инструменты.
Пользователь: ${username || "неизвестен"}
Предметы:
${subjectsList}
${scheduleContext}

ПРАВИЛА:
1. Вопросы о домашках, заданиях, ответах, дедлайнах → вызови listTasks. НИКОГДА не отвечай по памяти.
2. Пользователь просит показать/скинуть/отправить файл задания → вызови sendTaskFiles с taskId.
3. После вызова инструмента — ОБЯЗАТЕЛЬНО напиши текстовый ответ на русском.
4. ВСЕГДА используй subjectId из списка предметов выше. НИКОГДА не придумывай ID.
5. Если нужного предмета нет — создай через createSubject, потом используй полученный ID.
6. Когда в сообщении есть "Обнаружено N пронумерованных заданий" — это готовая разметка файлов. Следуй ей ТОЧНО: вызови createHomeworkBatch с ТАКИМ ЖЕ числом заданий. Каждое задание = "лаба N". Копируй file_id из attachments и answers как указано.
7. Обрабатывай ВСЕ файлы и ВСЕ задания из сообщения, не пропускай ни одного. Если 7 пар → 7 заданий, если 14 файлов → все 14.
8. Если непонятно куда прикрепить файлы — СПРОСИ уточнение, не угадывай.`;

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

    createHomeworkBatch: safeTool("createHomeworkBatch", {
      description: "Создать НЕСКОЛЬКО заданий сразу с файлами. Используй когда пользователь присылает много файлов для разных заданий/лаб. Каждый элемент массива = отдельное задание. Гораздо эффективнее чем вызывать createHomework + attachFileToTask по одному.",
      inputSchema: z.object({
        subjectId: z.string().describe("ID предмета из списка"),
        tasks: z.array(z.object({
          title: z.string().describe("Название задания"),
          emoji: z.string().optional().describe("Эмодзи (по умолчанию 📄)"),
          description: z.string().optional().describe("Описание задания"),
          attachments: z.array(z.object({
            fileId: z.string().describe("Telegram file_id"),
            fileType: z.enum(["document", "photo"]).describe("Тип файла"),
          })).optional().describe("Файлы условия задания"),
          answers: z.array(z.object({
            fileId: z.string().describe("Telegram file_id"),
            fileType: z.enum(["document", "photo"]).describe("Тип файла"),
          })).optional().describe("Файлы ответов/решений"),
        })).describe("Массив заданий для создания"),
      }),
      execute: async ({ subjectId, tasks: taskDefs }: {
        subjectId: string;
        tasks: Array<{
          title: string;
          emoji?: string;
          description?: string;
          attachments?: Array<{ fileId: string; fileType: "document" | "photo" }>;
          answers?: Array<{ fileId: string; fileType: "document" | "photo" }>;
        }>;
      }) => {
        debugLog("tool", `createHomeworkBatch: ${taskDefs.length} tasks for subject ${subjectId}`);
        const Subject = (await import("../models/Subject")).default;
        const subject = await Subject.findById(subjectId);
        if (!subject) return { error: "Предмет не найден" };

        // Build all tasks with attachments+answers upfront, then $push atomically
        const mongoose = await import("mongoose");
        const tasksToInsert = taskDefs.map(def => ({
          _id: new mongoose.Types.ObjectId(),
          title: def.title,
          emoji: def.emoji || "📄",
          description: def.description || "",
          attachments: (def.attachments || []).map(att => ({
            type: att.fileType,
            file_id: att.fileId,
          })),
          answers: (def.answers || []).map(ans => ({
            type: ans.fileType,
            content: "",
            file_id: ans.fileId,
          })),
        }));

        // Single atomic $push with $each — no race conditions
        await Subject.findByIdAndUpdate(subjectId, {
          $push: { tasks: { $each: tasksToInsert } },
        });

        const results = tasksToInsert.map(t => ({
          title: t.title,
          taskId: t._id.toString(),
          attachmentsCount: t.attachments.length,
          answersCount: t.answers.length,
        }));

        return {
          success: true,
          subjectName: subject.name,
          subjectEmoji: subject.emoji || "📚",
          createdCount: results.length,
          tasks: results,
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
      description: "Получить список заданий предмета с ID. Используй для любых вопросов о домашках. Если есть файлы (filesCount>0) и пользователь просит показать — вызови sendTaskFiles с ID задания. Если subjectId не указан — выводит задания ВСЕХ предметов.",
      inputSchema: z.object({
        subjectId: z.string().optional().describe("ID предмета из списка (если не указан — все предметы)"),
      }),
      execute: async ({ subjectId }: { subjectId?: string }) => {
        debugLog("tool", `listTasks: subjectId=${subjectId || "all"}`);
        console.log(`[listTasks] called with subjectId=${subjectId || "all"}`);
        const mapTask = (t: any) => ({
          id: t._id.toString(),
          title: t.title,
          emoji: t.emoji || "📄",
          description: t.description || null,
          deadline: t.deadline ? t.deadline.toISOString() : null,
          filesCount: (t.attachments || []).length,
          aiAnswer: t.aiAnswer ? t.aiAnswer.slice(0, 500) : null,
          answersCount: (t.answers || []).length,
          answersPreview: (t.answers || []).filter((a: any) => a.type === "text").map((a: any) => a.content?.slice(0, 200)).slice(0, 2),
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
        console.log(`[listTasks] allSubjects: ${allSubjects.length} subjects, tasks: ${allSubjects.map((s: any) => `${s.name}(${s.tasks?.length || 0})`).join(", ")}`);
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
      description: "Получить полную информацию о задании: описание, вложения (file_id), AI-решение, ответы пользователей. Когда нужно показать файл — возьми file_id из attachments и вызови forwardFileToChat.",
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
          subjectName: subject!.name,
          description: task.description || "(нет описания)",
          attachments: (task.attachments || []).map((a: any) => ({
            type: a.type,
            file_id: a.file_id,
          })),
          deadline: task.deadline ? task.deadline.toISOString() : null,
          aiAnswer: task.aiAnswer || null,
          answers: (task.answers || []).map((a: any) => ({
            type: a.type,
            content: a.type === "text" ? a.content : null,
            file_id: a.file_id || null,
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
        if (!task || !subject) return { error: "Задание не найдено" };
        if (!task.attachments) task.attachments = [];
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

    sendTaskFiles: safeTool("sendTaskFiles", {
      description: "Отправить файлы задания в чат. ИСПОЛЬЗУЙ когда пользователь просит показать, скинуть, отправить файл, вложение или условие задания. Отправляет ВСЕ вложения и файлы-ответы задания. Нужен только taskId (получи через listTasks).",
      inputSchema: z.object({
        taskId: z.string().describe("ID задания (получи через listTasks)"),
        sendAnswers: z.boolean().optional().describe("true = также отправить файлы-ответы (по умолчанию false — только вложения условия)"),
      }),
      execute: async ({ taskId, sendAnswers = false }: { taskId: string; sendAnswers?: boolean }) => {
        const { getBot } = require("../lib/bot");
        const bot = getBot();
        if (!bot || !chatId) return { error: "Нет доступа к чату" };

        const { task } = await subjectService.getTask(taskId);
        if (!task) return { error: "Задание не найдено" };

        debugLog("tool", `sendTaskFiles: ${task.title} (answers: ${sendAnswers})`);

        const filesToSend: Array<{ type: string; file_id: string; caption: string }> = [];

        for (const att of task.attachments || []) {
          if (att.file_id) {
            filesToSend.push({ type: att.type, file_id: att.file_id, caption: `📎 ${task.title}` });
          }
        }

        if (sendAnswers) {
          for (const ans of task.answers || []) {
            if (ans.file_id) {
              filesToSend.push({ type: ans.type, file_id: ans.file_id, caption: `📝 Ответ: ${task.title}` });
            }
          }
        }

        if (filesToSend.length === 0) {
          return { error: sendAnswers ? "У задания нет файлов" : "У задания нет вложений. Попробуй sendAnswers=true чтобы отправить файлы-ответы." };
        }

        let sent = 0;
        for (const f of filesToSend) {
          try {
            if (f.type === "photo") {
              await bot.telegram.sendPhoto(chatId, f.file_id, { caption: f.caption });
            } else {
              await bot.telegram.sendDocument(chatId, f.file_id, { caption: f.caption });
            }
            sent++;
          } catch (e: any) {
            debugLog("tool-error", `sendTaskFiles: failed to send ${f.type}: ${e.message}`);
          }
        }

        return { success: true, sentCount: sent, totalFiles: filesToSend.length, taskTitle: task.title };
      },
    }),

    forwardFileToChat: safeTool("forwardFileToChat", {
      description: "Отправить файл/фото в чат по file_id. Для файлов заданий лучше используй sendTaskFiles (нужен только taskId). Этот инструмент — для отправки file_id из метаданных сообщения пользователя.",
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

    // --- Напоминания ---

    createReminder: safeTool("createReminder", {
      description: "Создать напоминание. Бот отправит сообщение в текущий чат в указанное время. Используй когда пользователь просит напомнить о чём-то. Сегодня: " + new Date().toISOString().slice(0, 10),
      inputSchema: z.object({
        text: z.string().describe("Текст напоминания"),
        scheduledAt: z.string().describe("Когда напомнить — ISO дата+время (YYYY-MM-DDTHH:mm). Например: 2026-03-09T09:00"),
      }),
      execute: async ({ text, scheduledAt }: { text: string; scheduledAt: string }) => {
        if (!chatId) return { error: "Нет доступа к чату" };
        const date = new Date(scheduledAt);
        if (isNaN(date.getTime())) return { error: "Некорректная дата" };
        if (date.getTime() <= Date.now()) return { error: "Дата должна быть в будущем" };

        debugLog("tool", `createReminder: "${text.slice(0, 50)}" at ${scheduledAt} in chat ${chatId}`);
        const reminder = await reminderService.create({
          chatId: String(chatId),
          userId: 0,
          username: username || "",
          text,
          scheduledAt: date,
        });
        return {
          success: true,
          reminderId: reminder._id.toString(),
          text: text.slice(0, 100),
          scheduledAt: date.toISOString(),
        };
      },
    }),

    listReminders: safeTool("listReminders", {
      description: "Показать активные напоминания в текущем чате.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!chatId) return { error: "Нет доступа к чату" };
        debugLog("tool", `listReminders: chat ${chatId}`);
        const reminders = await reminderService.listByChat(String(chatId));
        return {
          reminders: reminders.map((r: any) => ({
            id: r._id.toString(),
            text: r.text,
            scheduledAt: r.scheduledAt.toISOString(),
            username: r.username || "—",
          })),
        };
      },
    }),

    cancelReminder: safeTool("cancelReminder", {
      description: "Отменить напоминание по ID.",
      inputSchema: z.object({
        reminderId: z.string().describe("ID напоминания (получи через listReminders)"),
      }),
      execute: async ({ reminderId }: { reminderId: string }) => {
        debugLog("tool", `cancelReminder: ${reminderId}`);
        const result = await reminderService.cancel(reminderId);
        if (!result) return { error: "Напоминание не найдено или уже отправлено" };
        return { success: true, cancelledText: result.text.slice(0, 100) };
      },
    }),
  };

  return { tools, systemPromptAddition, maxSteps: 20 };
}

export { buildAssistantTools };
