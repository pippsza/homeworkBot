const { trackSend, isPrivate } = require("../helpers/editOrSend");
const inputState = require("../helpers/inputState");
const { updateCollectMessage } = require("./homework");

async function deleteUserMsg(ctx) {
  await ctx
    .deleteMessage(ctx.message.message_id)
    .catch((e) => console.error("Delete user msg error", e));
}

function mediaHandler(bot) {
  bot.on("document", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      // Collect documents for homework creation
      if (state.mode === "collect_hw") {
        const file_id = ctx.message.document.file_id;
        state.attachments.push({ type: "document", file_id });
        const caption = ctx.message.caption;
        if (caption) state.messages.push(caption);
        inputState.set(ctx.from.id, state);
        await updateCollectMessage(ctx, state);
        return;
      }
      if (state.step === "attachments") {
        const file_id = ctx.message.document.file_id;
        state.attachments.push({ type: "document", file_id });
        await trackSend(ctx, () =>
          ctx.reply(
            "✅ Файл добавлен. Можете добавить ещё или нажмите '✅ Готово'.",
            { disable_notification: !isPrivate(ctx) }
          )
        );
      }
      if (state.mode === "add_answer" && state.step === "answer") {
        const file_id = ctx.message.document.file_id;
        state.answers.push({ type: "document", file_id });
        await trackSend(ctx, () =>
          ctx.reply("✅ Файл добавлен. Добавьте ещё или нажмите Готово.", {
            disable_notification: !isPrivate(ctx),
          })
        );
      }
    } catch (e) {
      console.error("[document handler error]", e);
    } finally {
      await deleteUserMsg(ctx);
    }
  });

  bot.on("photo", async (ctx) => {
    const state = inputState.get(ctx.from.id);
    if (!state) return;
    try {
      // Collect photos for homework creation
      if (state.mode === "collect_hw") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.attachments.push({ type: "photo", file_id });
          const caption = ctx.message.caption;
          if (caption) state.messages.push(caption);
          inputState.set(ctx.from.id, state);
          await updateCollectMessage(ctx, state);
        }
        return;
      }
      if (state.step === "attachments") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.attachments.push({ type: "photo", file_id });
          await trackSend(ctx, () =>
            ctx.reply(
              "✅ Фото добавлено. Можете добавить ещё или нажмите '✅ Готово'.",
              { disable_notification: !isPrivate(ctx) }
            )
          );
        }
      }
      if (state.mode === "add_answer" && state.step === "answer") {
        const photo = ctx.message.photo;
        if (photo && photo.length) {
          const file_id = photo[photo.length - 1].file_id;
          state.answers.push({ type: "photo", file_id });
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
      await deleteUserMsg(ctx);
    }
  });

  // Reset input state on non-edit/add/homework callbacks
  bot.on("callback_query", async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;
      if (data && !data.startsWith("e") && !data.startsWith("a") && !data.startsWith("hw_")) {
        inputState.delete(ctx.from.id);
      }
    } catch (e) {
      console.error("[callback_query error]", e);
    }
  });
}

module.exports = mediaHandler;
