import { Context } from "telegraf";
import * as userService from "../../services/userService";

export function getUsername(ctx: Context): string | null {
  if (!ctx.from || !ctx.from.username) return null;
  return `@${ctx.from.username}`;
}

export async function isStudent(ctx: Context): Promise<boolean> {
  const u = getUsername(ctx);
  return u ? await userService.isStudent(u) : false;
}

export async function isSuperadmin(ctx: Context): Promise<boolean> {
  const u = getUsername(ctx);
  return u ? await userService.isSuperadmin(u) : false;
}
