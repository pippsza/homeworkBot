import Reminder, { IReminder } from "../models/Reminder";

async function create(data: {
  chatId: string;
  userId: number;
  username: string;
  text: string;
  scheduledAt: Date;
}): Promise<IReminder> {
  return Reminder.create(data);
}

async function getPending(): Promise<IReminder[]> {
  return Reminder.find({
    status: "pending",
    scheduledAt: { $lte: new Date() },
  }).limit(50);
}

async function markSent(id: string): Promise<void> {
  await Reminder.updateOne({ _id: id }, { status: "sent" });
}

async function cancel(id: string): Promise<IReminder | null> {
  return Reminder.findOneAndUpdate(
    { _id: id, status: "pending" },
    { status: "cancelled" },
    { new: true }
  );
}

async function listByUser(userId: number): Promise<IReminder[]> {
  return Reminder.find({ userId, status: "pending" })
    .sort({ scheduledAt: 1 })
    .limit(20);
}

async function listByChat(chatId: string): Promise<IReminder[]> {
  return Reminder.find({ chatId, status: "pending" })
    .sort({ scheduledAt: 1 })
    .limit(20);
}

export { create, getPending, markSent, cancel, listByUser, listByChat };
