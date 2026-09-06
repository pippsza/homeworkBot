import NotifyTarget, { INotifyTarget } from "../models/NotifyTarget";

export type NotifyKind = "daily" | "lessons" | "deadlines" | "weekly";

export async function all(): Promise<INotifyTarget[]> {
  return NotifyTarget.find().sort({ createdAt: 1 });
}

export async function forKind(kind: NotifyKind): Promise<INotifyTarget[]> {
  return NotifyTarget.find({ enabled: true, [kind]: true });
}

export async function upsert(chatId: string, title: string): Promise<INotifyTarget> {
  const doc = await NotifyTarget.findOneAndUpdate(
    { chatId },
    { $setOnInsert: { chatId }, $set: { title } },
    { upsert: true, returnDocument: "after" }
  );
  return doc!;
}

export async function toggle(chatId: string, kind: NotifyKind | "enabled"): Promise<INotifyTarget | null> {
  const doc = await NotifyTarget.findOne({ chatId });
  if (!doc) return null;
  (doc as any)[kind] = !(doc as any)[kind];
  return doc.save();
}
