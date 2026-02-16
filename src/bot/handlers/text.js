const { Markup } = require("telegraf");
const { trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const subjectService = require("../../services/subjectService");
const infoService = require("../../services/infoService");
const userService = require("../../services/userService");
const { mainMenu } = require("./start");
const { subjectEditMenu } = require("./subjects");
const { taskEditMenu, showTask } = require("./tasks");
const { infoEditMenu } = require("./infos");
const { showSettings } = require("./settings");

async function deleteUserMsg(ctx) {
  await ctx
    .deleteMessage(ctx.message.message_id)
    .catch((e) => console.error("Delete user msg error", e));
}

function textHandler(bot) {
  bot.on("text", async (ctx) => {
    if (ctx.message.text === "/start") {
      inputState.delete(ctx.from.id);
      return mainMenu(ctx);
    }

    if (ctx.message.text === "/cancel") {
      const hadState = inputState.get(ctx.from.id);
      inputState.delete(ctx.from.id);
      if (hadState) {
        await trackSend(ctx, () =>
          ctx.reply("❌ Действие отменено.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
      await mainMenu(ctx);
      await deleteUserMsg(ctx);
      return;
    }

    if (ctx.message.text === "🏠 Главное меню") {
      inputState.delete(ctx.from.id);
      await mainMenu(ctx);
      await deleteUserMsg(ctx);
      return;
    }

    const state = inputState.get(ctx.from.id);
    if (!state) return;

    const text = ctx.message.text.trim();

    try {
    // Add user
    if (state.mode === "add_user") {
      const username = text;
      if (!username.startsWith("@")) {
        await trackSend(ctx, () =>
          ctx.reply("❌ Введите username с @", {
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      const roleMap = {
        add_admin: { field: "admins", label: "админ" },
        add_answer_viewer: { field: "answerViewers", label: "просмотрщик ответов" },
        add_superuser: { field: "superusers", label: "суперпользователь" },
      };
      const { field, label } = roleMap[state.step];
      const added = await userService.addUser(field, username);
      if (!added) {
        await trackSend(ctx, () =>
          ctx.reply(`❌ Уже есть такой ${label}.`, {
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      inputState.delete(ctx.from.id);
      await trackSend(ctx, () =>
        ctx.reply(
          `✅ ${label.charAt(0).toUpperCase() + label.slice(1)} добавлен.`,
          { disable_notification: !isPrivate(ctx) }
        )
      );
      await showSettings(ctx);
      await deleteUserMsg(ctx);
      return;
    }

    // Edit subject fields
    if (state.mode === "edit_subject") {
      const fieldMap = {
        name: "name",
        emoji: "emoji",
        lecturer_name: "lecturerName",
        lecturer_contact: "lecturerContact",
        practitioner_name: "practitionerName",
        practitioner_contact: "practitionerContact",
      };
      const dbField = fieldMap[state.step];
      if (dbField) {
        if (state.step === "name" && !text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Название не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          return;
        }
        const value =
          state.step === "emoji" ? text || "📚" : text;
        await subjectService.update(state.subjectId, { [dbField]: value });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Обновлено!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в предмете?\n\n---",
          subjectEditMenu(state.subjectId)
        );
        await deleteUserMsg(ctx);
        return;
      }
    }

    // Add/edit subject multi-step
    if (state.mode === "add_subject") {
      if (state.step === "name") {
        if (!text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Название не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          return;
        }
        state.name = text;
        state.step = "emoji";
        await trackSend(ctx, () =>
          ctx.reply(
            "😀 Введите смайлик для предмета (например, 📐) или пропустите:",
            { disable_notification: !isPrivate(ctx) }
          )
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "📚";
        state.step = "lecturer_name";
        await trackSend(ctx, () =>
          ctx.reply("👨‍🏫 Введите ФИО лектора (или пропустите):", {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("Пропустить", "skip_lecturer_name")],
            ]),
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "lecturer_name") {
        state.lecturerName = text;
        state.step = "lecturer_contact";
        await trackSend(ctx, () =>
          ctx.reply(
            "📞 Введите контакты лектора (соц. сети, почта и т.д.) (или пропустите):",
            {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "Пропустить",
                    "skip_lecturer_contact"
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            }
          )
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "lecturer_contact") {
        state.lecturerContact = text;
        state.step = "practitioner_name";
        await trackSend(ctx, () =>
          ctx.reply("👩‍🏫 Введите ФИО практики (или пропустите):", {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "Пропустить",
                  "skip_practitioner_name"
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "practitioner_name") {
        state.practitionerName = text;
        state.step = "practitioner_contact";
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
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "practitioner_contact") {
        state.practitionerContact = text;
        await subjectService.create({
          name: state.name,
          emoji: state.emoji || "📚",
          lecturerName: state.lecturerName,
          lecturerContact: state.lecturerContact,
          practitionerName: state.practitionerName,
          practitionerContact: state.practitionerContact,
          tasks: [],
        });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Предмет сохранён!\n\n---", {
            disable_notification: !isPrivate(ctx),
          })
        );
        await mainMenu(ctx);
        await deleteUserMsg(ctx);
        return;
      }
    }

    // Add/edit task multi-step
    if (state.mode === "add_task" || state.mode === "edit_task") {
      if (state.step === "title") {
        if (!text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Заголовок не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await deleteUserMsg(ctx);
          return;
        }
        state.title = text;
        state.step = "emoji";
        await trackSend(ctx, () =>
          ctx.reply(
            "😀 Введите смайлик для задания (например, 📄) или пропустите:",
            { disable_notification: !isPrivate(ctx) }
          )
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "📄";
        state.step = "description";
        const skipId = state.subjectId || state.taskId;
        await trackSend(ctx, () =>
          ctx.reply("📄 Введите описание (или пропустите):", {
            ...Markup.inlineKeyboard([
              [Markup.button.callback("Пропустить", `skd_${skipId}`)],
            ]),
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "description") {
        state.description = text;
        state.step = "attachments";
        const finishId = state.subjectId || state.taskId;
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
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_title") {
        if (!text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Заголовок не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          await deleteUserMsg(ctx);
          return;
        }
        await subjectService.updateTask(state.taskId, { title: text });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Заголовок обновлён!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в задании?\n\n---",
          taskEditMenu(state.taskId)
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_emoji") {
        await subjectService.updateTask(state.taskId, {
          emoji: text || "📄",
        });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Emoji обновлён!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в задании?\n\n---",
          taskEditMenu(state.taskId)
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_description") {
        await subjectService.updateTask(state.taskId, { description: text });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Описание обновлено!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в задании?\n\n---",
          taskEditMenu(state.taskId)
        );
        await deleteUserMsg(ctx);
        return;
      }
    }

    // Add/edit info multi-step
    if (state.mode === "add_info" || state.mode === "edit_info") {
      if (state.step === "title") {
        if (!text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Заголовок не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          return;
        }
        state.title = text;
        state.step = "emoji";
        await trackSend(ctx, () =>
          ctx.reply(
            "😀 Введите смайлик для информации (например, ℹ️) или пропустите:",
            { disable_notification: !isPrivate(ctx) }
          )
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "emoji") {
        state.emoji = text || "ℹ️";
        state.step = "description";
        const isAdd = state.mode === "add_info";
        await trackSend(ctx, () =>
          ctx.reply("📄 Введите описание (или пропустите):", {
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  "Пропустить",
                  isAdd ? "skip_info_description" : `skid_${state.infoId}`
                ),
              ],
            ]),
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "description") {
        state.description = text;
        state.step = "attachments";
        const isAdd = state.mode === "add_info";
        await trackSend(ctx, () =>
          ctx.reply(
            '📎 Отправьте файлы/фото для информации. Когда закончите, нажмите "✅ Готово".\n\n---',
            {
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    "✅ Готово",
                    isAdd
                      ? "finish_add_info_attachments"
                      : `fia_${state.infoId}`
                  ),
                ],
              ]),
              disable_notification: !isPrivate(ctx),
            }
          )
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_title") {
        if (!text) {
          await trackSend(ctx, () =>
            ctx.reply("❌ Заголовок не может быть пустым.", {
              disable_notification: !isPrivate(ctx),
            })
          );
          return;
        }
        await infoService.update(state.infoId, { title: text });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Заголовок обновлён!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в информации?\n\n---",
          infoEditMenu(state.infoId)
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_emoji") {
        await infoService.update(state.infoId, { emoji: text || "ℹ️" });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Emoji обновлён!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в информации?\n\n---",
          infoEditMenu(state.infoId)
        );
        await deleteUserMsg(ctx);
        return;
      }
      if (state.step === "edit_description") {
        await infoService.update(state.infoId, { description: text });
        inputState.delete(ctx.from.id);
        await trackSend(ctx, () =>
          ctx.reply("✅ Описание обновлено!", {
            disable_notification: !isPrivate(ctx),
          })
        );
        const { editOrSend } = require("../helpers/editOrSend");
        await editOrSend(
          ctx,
          "✏️ Что хотите изменить в информации?\n\n---",
          infoEditMenu(state.infoId)
        );
        await deleteUserMsg(ctx);
        return;
      }
    }

    // Add answer (text)
    if (state.mode === "add_answer" && state.step === "answer") {
      if (text) {
        state.answers.push({ type: "text", content: text });
        await trackSend(ctx, () =>
          ctx.reply("✅ Текст добавлен. Добавьте ещё или нажмите Готово.", {
            disable_notification: !isPrivate(ctx),
          })
        );
        await deleteUserMsg(ctx);
      }
    }
    } catch (e) {
      console.error("[text handler error]", e);
      await trackSend(ctx, () =>
        ctx.reply("❌ Произошла ошибка. Попробуйте снова или /cancel.", {
          disable_notification: !isPrivate(ctx),
        })
      ).catch(() => {});
    }
  });
}

module.exports = textHandler;
