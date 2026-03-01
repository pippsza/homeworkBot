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
async function buildAssistantTools() {
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
Доступные предметы:
${subjectsList}
${scheduleContext}

ПРАВИЛА ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ ДОМАШКУ/ЗАДАНИЕ — ВЫЗОВИ createHomework.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ЗАПОМНИТЬ/СОХРАНИТЬ ИНФОРМАЦИЮ — ВЫЗОВИ rememberInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ ГОВОРИТ ФИО ПРЕПОДАВАТЕЛЯ/ПРАКТИКА ИЛИ ПРОСИТ ОБНОВИТЬ ПРЕДМЕТ — ВЫЗОВИ updateSubject.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ИЗМЕНИТЬ ЗАДАНИЕ — ВЫЗОВИ updateTask.
- КОГДА ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ О РАСПИСАНИИ НА ДРУГУЮ ДАТУ — ВЫЗОВИ getSchedule.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРИСЫЛАЕТ РАСПИСАНИЕ ИЛИ ПРОСИТ НАСТРОИТЬ РАСПИСАНИЕ — ВЫЗОВИ setTimeSlots (время пар), затем setDaySchedule для каждого дня (Пн-Пт). Используй ID предметов из списка выше. Для мигалок (чередование по неделям) установи isAlternating: true и укажи subjectId (нечётная) и subjectIdEven (чётная).
- НИКОГДА не отвечай текстом "я сделал" без реального вызова инструмента.`;

  const tools = {
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
  };

  return { tools, systemPromptAddition, maxSteps: 10 };
}

module.exports = { buildAssistantTools };
