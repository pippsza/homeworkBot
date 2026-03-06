import GroupMember, { IGroupMember } from "../models/GroupMember";

interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export async function track(chatId: number, user: TelegramUser | undefined): Promise<void> {
  if (!chatId || !user?.id) return;
  await GroupMember.findOneAndUpdate(
    { chatId, userId: user.id },
    {
      firstName: user.first_name || "",
      username: user.username || "",
      lastSeen: new Date(),
    },
    { upsert: true, returnDocument: "after" }
  );
}

export async function getMembers(chatId: number): Promise<IGroupMember[]> {
  return GroupMember.find({ chatId }).sort({ lastSeen: -1 });
}
