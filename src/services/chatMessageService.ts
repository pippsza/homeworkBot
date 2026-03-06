import ChatMessages from "../models/ChatMessages";

export async function trackMessage(chatId: string | number, messageId: number): Promise<void> {
  await ChatMessages.findOneAndUpdate(
    { chatId: String(chatId) },
    { $push: { messageIds: messageId } },
    { upsert: true }
  );
}

export async function getMessages(chatId: string | number): Promise<number[]> {
  const doc = await ChatMessages.findOne({ chatId: String(chatId) });
  return doc ? doc.messageIds : [];
}

export async function clearMessages(chatId: string | number): Promise<void> {
  await ChatMessages.findOneAndUpdate(
    { chatId: String(chatId) },
    { messageIds: [] }
  );
}
