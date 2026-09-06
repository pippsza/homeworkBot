import crypto from "crypto";
import MediaCache from "../models/MediaCache";

const memo = new Map<string, string>();
const MAX_MEMO = 2000;

export function hash(input: string | Buffer): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 20);
}

export async function get(key: string): Promise<string | null> {
  const hit = memo.get(key);
  if (hit) return hit;
  try {
    const doc = await MediaCache.findOne({ key }).lean<{ fileId: string } | null>();
    if (doc?.fileId) {
      remember(key, doc.fileId);
      return doc.fileId;
    }
  } catch (e) {
    console.error("[mediaCache] read failed:", (e as Error).message);
  }
  return null;
}

export async function put(key: string, fileId: string): Promise<void> {
  remember(key, fileId);
  try {
    await MediaCache.updateOne({ key }, { $set: { fileId, usedAt: new Date() } }, { upsert: true });
  } catch (e) {
    console.error("[mediaCache] write failed:", (e as Error).message);
  }
}

/** Викидаємо все, що починається з префікса: викликаємо, коли дані змінились. */
export async function drop(prefix: string): Promise<void> {
  for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k);
  try {
    await MediaCache.deleteMany({ key: new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  } catch (e) {
    console.error("[mediaCache] drop failed:", (e as Error).message);
  }
}

function remember(key: string, fileId: string): void {
  memo.set(key, fileId);
  if (memo.size > MAX_MEMO) memo.delete(memo.keys().next().value as string);
}
