const { tool, jsonSchema } = require("ai");
const subjectService = require("./subjectService");
const infoService = require("./infoService");

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

  const systemPromptAddition = `\n\nТы — полноценный AI-ассистент для учебного бота. У тебя есть инструменты для управления данными.
Доступные предметы:
${subjectsList}

ПРАВИЛА ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ СОЗДАТЬ ДОМАШКУ/ЗАДАНИЕ — ВЫЗОВИ createHomework.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ЗАПОМНИТЬ/СОХРАНИТЬ ИНФОРМАЦИЮ — ВЫЗОВИ rememberInfo.
- КОГДА ПОЛЬЗОВАТЕЛЬ ГОВОРИТ ФИО ПРЕПОДАВАТЕЛЯ/ПРАКТИКА ИЛИ ПРОСИТ ОБНОВИТЬ ПРЕДМЕТ — ВЫЗОВИ updateSubject.
- КОГДА ПОЛЬЗОВАТЕЛЬ ПРОСИТ ИЗМЕНИТЬ ЗАДАНИЕ — ВЫЗОВИ updateTask.
- НИКОГДА не отвечай текстом "я сделал" без реального вызова инструмента.`;

  const tools = {
    createHomework: tool({
      description: "Создать домашнее задание. Используй когда пользователь просит создать, добавить домашку или задание.",
      parameters: jsonSchema({
        type: "object",
        properties: {
          subjectId: { type: "string", description: "ID предмета из списка доступных предметов" },
          title: { type: "string", description: "Название задания (краткое, 5-15 слов)" },
          emoji: { type: "string", description: "Эмодзи для задания (по умолчанию 📄)" },
          description: { type: "string", description: "Полное описание задания" },
        },
        required: ["subjectId", "title", "description"],
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
      parameters: jsonSchema({
        type: "object",
        properties: {
          title: { type: "string", description: "Краткий заголовок (3-10 слов)" },
          emoji: { type: "string", description: "Подходящий emoji (по умолчанию ℹ️)" },
          description: { type: "string", description: "Полный текст информации для запоминания" },
        },
        required: ["title", "emoji", "description"],
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
      parameters: jsonSchema({
        type: "object",
        properties: {
          subjectId: { type: "string", description: "ID предмета из списка" },
          name: { type: "string", description: "Новое название предмета. Пустая строка — не менять" },
          emoji: { type: "string", description: "Новый эмодзи. Пустая строка — не менять" },
          lecturerName: { type: "string", description: "ФИО лектора. Пустая строка — не менять" },
          lecturerContact: { type: "string", description: "Контакт лектора. Пустая строка — не менять" },
          practitionerName: { type: "string", description: "ФИО практика. Пустая строка — не менять" },
          practitionerContact: { type: "string", description: "Контакт практика. Пустая строка — не менять" },
        },
        required: ["subjectId", "name", "emoji", "lecturerName", "lecturerContact", "practitionerName", "practitionerContact"],
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
      parameters: jsonSchema({
        type: "object",
        properties: {
          taskId: { type: "string", description: "ID задания" },
          title: { type: "string", description: "Новое название. Пустая строка — не менять" },
          emoji: { type: "string", description: "Новый эмодзи. Пустая строка — не менять" },
          description: { type: "string", description: "Новое описание. Пустая строка — не менять" },
        },
        required: ["taskId", "title", "emoji", "description"],
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
  };

  return { tools, systemPromptAddition, maxSteps: 3 };
}

module.exports = { buildAssistantTools };
