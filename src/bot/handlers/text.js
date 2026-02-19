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
const { isAdmin, isReviewer } = require("../middleware/auth");
const { processQuery } = require("../../services/orchestratorService");
const ChatHistory = require("../../models/ChatHistory");
const { mdToHtml } = require("./ai");
const { isForwarded, getMessageText: getHwMsgText, updateCollectMessage } = require("./homework");

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

    // Forwarded messages → collect for homework creation (admins only, private chat)
    const preState = inputState.get(ctx.from.id);
    if (isForwarded(ctx.message) && isPrivate(ctx) && (await isAdmin(ctx))) {
      const msgText = getHwMsgText(ctx.message);
      if (preState?.mode === "collect_hw") {
        // Append to existing collection
        if (msgText) preState.messages.push(msgText);
        inputState.set(ctx.from.id, preState);
        await updateCollectMessage(ctx, preState);
        return;
      }
      // Start new collection
      const newState = {
        mode: "collect_hw",
        messages: msgText ? [msgText] : [],
        attachments: [],
        statusMessageId: null,
      };
      inputState.set(ctx.from.id, newState);
      await updateCollectMessage(ctx, newState);
      return;
    }

    // If in collect_hw mode and non-forwarded text → also append (user adds context)
    if (preState?.mode === "collect_hw" && isPrivate(ctx)) {
      const text = ctx.message.text?.trim();
      if (text) {
        preState.messages.push(text);
        inputState.set(ctx.from.id, preState);
        await updateCollectMessage(ctx, preState);
      }
      return;
    }

    // AI conversation: reply to bot message OR ai_chat mode
    const state = inputState.get(ctx.from.id);
    const isAiReply =
      !state &&
      ctx.message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isAiChat = state?.mode === "ai_chat";

    if ((isAiReply || isAiChat) && (await isReviewer(ctx))) {
      const question = ctx.message.text.trim();
      if (!question) return;

      const thinking = await ctx.reply("Думаю...", {
        disable_notification: !isPrivate(ctx),
      });

      try {
        const history = await ChatHistory.findOne({ telegramUserId: ctx.from.id });
        const recentMessages = (history?.messages || [])
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content }));

        const text = await processQuery(question, recentMessages);
        const htmlText = mdToHtml(text).slice(0, 4096);

        await ctx.telegram
          .editMessageText(ctx.chat.id, thinking.message_id, null, htmlText, {
            parse_mode: "HTML",
          })
          .catch(() =>
            ctx.telegram.editMessageText(
              ctx.chat.id, thinking.message_id, null, text.slice(0, 4096)
            )
          );

        // Keep user in ai_chat mode
        inputState.set(ctx.from.id, { mode: "ai_chat" });

        await ChatHistory.findOneAndUpdate(
          { telegramUserId: ctx.from.id },
          {
            $push: {
              messages: {
                $each: [
                  { role: "user", content: question },
                  { role: "assistant", content: text },
                ],
              },
            },
          },
          { upsert: true }
        ).catch((e) => console.error("[ai reply] history save error:", e.message));
      } catch (e) {
        console.error("[ai reply] error:", e);
        await ctx.telegram
          .editMessageText(ctx.chat.id, thinking.message_id, null, "Ошибка AI. Попробуйте позже.")
          .catch(() => {});
      }
      return;
    }

    if (!state || state.mode === "ai_chat") return;

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
        add_reviewer: { field: "reviewers", label: "ревьювер" },
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
