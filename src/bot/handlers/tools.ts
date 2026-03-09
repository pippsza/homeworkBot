import { Telegraf, Context, Markup } from "telegraf";
import { isSuperadmin } from "../middleware/auth";
import { editOrSend, trackSend, isPrivate } from "../helpers/editOrSend";
import * as chatMessageService from "../../services/chatMessageService";
import * as groupMemberService from "../../services/groupMemberService";

function toolsHandler(bot: Telegraf): void {
  bot.action("tools", async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) {
      return ctx.answerCbQuery("❌ Нет прав.", { show_alert: true });
    }
    await editOrSend(
      ctx,
      "🛠 Инструменты\n\n---",
      Markup.inlineKeyboard([
        [Markup.button.callback("Перекличка", "roll_call")],
        [Markup.button.callback("Очистка", "cleanup")],
        [Markup.button.callback("⬅️ Назад", "main_menu")],
      ]) as any
    );
  });

  bot.action("roll_call", async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) return;

    if (isPrivate(ctx)) {
      return trackSend(ctx, () =>
        ctx.reply("📋 Перекличка доступна только в группах.")
      );
    }

    const chatId = ctx.chat!.id;

    // Collect users from all available sources
    const userMap = new Map<number, { userId: number; firstName: string; username: string }>();

    // 1. Admins from Telegram API (always available)
    try {
      const admins = await ctx.telegram.getChatAdministrators(chatId);
      for (const member of admins) {
        if (member.user.is_bot) continue;
        userMap.set(member.user.id, {
          userId: member.user.id,
          firstName: member.user.first_name || "",
          username: member.user.username || "",
        });
      }
    } catch (e: any) {
      console.error("[roll_call] getChatAdministrators error:", e.message);
    }

    // 2. Tracked members from DB (users who interacted with bot)
    const tracked = await groupMemberService.getMembers(chatId);
    for (const m of tracked) {
      if (!userMap.has(m.userId)) {
        userMap.set(m.userId, m);
      }
    }

    if (userMap.size === 0) {
      return trackSend(ctx, () =>
        ctx.reply("📋 Список пуст.")
      );
    }

    const mentions = [...userMap.values()].map(
      (m) => `<a href="tg://user?id=${m.userId}">${m.firstName || m.username || String(m.userId)}</a>`
    );

    const total = await ctx.telegram.getChatMembersCount(chatId).catch(() => null);
    let msg = "📋 Перекличка:\n\n" + mentions.join(", ");
    if (total && total > userMap.size) {
      msg += `\n\n<i>Найдено ${userMap.size} из ~${total}. Остальные появятся когда напишут в чат.</i>`;
    }
    await trackSend(ctx, () =>
      ctx.reply(msg, { parse_mode: "HTML" })
    );
  });

  bot.action("cleanup", async (ctx: Context) => {
    if (!(await isSuperadmin(ctx))) return;
    const chatId = ctx.chat!.id;
    const messageIds = await chatMessageService.getMessages(chatId);
    for (const id of messageIds) {
      await ctx.telegram
        .deleteMessage(chatId, id)
        .catch((e: any) => console.error(`Delete error for ${id}`, e));
    }
    await chatMessageService.clearMessages(chatId);
    await trackSend(ctx, () =>
      ctx.reply("Очистка завершена.", { disable_notification: !isPrivate(ctx) })
    );
  });
}

export default toolsHandler;
