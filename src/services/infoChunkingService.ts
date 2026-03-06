import { Telegraf } from "telegraf";
import * as chunkingService from "./chunkingService";
import Info from "../models/Info";

const embeddingService = require("./embeddingService");
const qdrantService = require("./qdrantService");

interface ChunkResult {
  chunks: string[];
  embeddings: number[][];
}

interface DownloadedFile {
  buffer: Buffer;
  mimetype: string;
}

/**
 * Generate deterministic Qdrant point IDs from info ID.
 * desc chunks: base*1000 + 0..499999
 * att chunks: base*1000 + 500000..999999
 */
function generatePointId(infoId: string, type: "desc" | "att", index: number): number {
  const base = parseInt(infoId.slice(-6), 16);
  const typeOffset = type === "desc" ? 0 : 500000;
  return base * 1000 + typeOffset + index;
}

/**
 * Download a Telegram file by file_id and return Buffer + mimetype.
 */
async function downloadTelegramFile(fileId: string): Promise<DownloadedFile> {
  const bot = new Telegraf(process.env.BOT_TOKEN!);
  const url = await bot.telegram.getFileLink(fileId);
  const response = await fetch(url.href);
  if (!response.ok)
    throw new Error(`Telegram file download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType =
    response.headers.get("content-type") || "application/octet-stream";
  return { buffer, mimetype: contentType };
}

/**
 * Chunk and embed an Info record's description text.
 * Returns { chunks: string[], embeddings: number[][] }
 */
async function chunkDescription(description: string | undefined): Promise<ChunkResult> {
  if (!description || description.trim().length < 3) return { chunks: [], embeddings: [] };

  // chunkText filters out chunks < 20 chars, but short facts from "zapomni" are valuable
  let chunks = chunkingService.chunkText(description);
  if (chunks.length === 0) {
    chunks = [description.trim()];
  }
  if (chunks.length === 0) return { chunks: [], embeddings: [] };

  const embeddings = await embeddingService.embedTexts(chunks);
  return { chunks, embeddings };
}

/**
 * Parse and chunk Info attachments (documents get parsed, photos get OCR'd).
 * Returns { chunks: string[], embeddings: number[][] }
 */
async function chunkAttachments(attachments: any[] | undefined): Promise<ChunkResult> {
  if (!attachments || attachments.length === 0) return { chunks: [], embeddings: [] };

  const allChunks: string[] = [];

  for (const att of attachments) {
    if (att.type !== "document" && att.type !== "photo") continue;

    try {
      const { buffer, mimetype } = await downloadTelegramFile(att.file_id);
      const effectiveMime = att.type === "photo" ? "image/jpeg" : mimetype;
      const text = await chunkingService.parseFile(
        buffer,
        effectiveMime,
        `attachment_${att._id}`
      );
      if (text && text.trim().length >= 20) {
        allChunks.push(...chunkingService.chunkText(text));
      }
    } catch (e: any) {
      console.error(
        `[infoChunking] failed to process attachment ${att.file_id}:`,
        e.message
      );
    }
  }

  if (allChunks.length === 0) return { chunks: [], embeddings: [] };

  const embeddings = await embeddingService.embedTexts(allChunks);
  return { chunks: allChunks, embeddings };
}

interface QdrantPoint {
  id: number;
  text: string;
  embedding: number[];
  documentId: string;
}

/**
 * Full sync: delete existing chunks -> re-chunk description + attachments -> embed -> upsert.
 * Updates info.chunkCount in MongoDB.
 * Returns total chunk count.
 */
async function syncInfoChunks(infoId: string): Promise<number> {
  const info = await Info.findById(infoId);
  if (!info) return 0;

  const idStr = infoId.toString();

  // Delete old chunks
  await qdrantService.deleteGeneralByDocumentId(idStr);

  // Chunk description
  const desc = await chunkDescription(info.description);

  // Chunk attachments
  const att = await chunkAttachments(info.attachments);

  const totalChunks = desc.chunks.length + att.chunks.length;

  if (totalChunks > 0) {
    await qdrantService.ensureGeneralCollection();

    const points: QdrantPoint[] = [];

    // Description chunks
    desc.chunks.forEach((text, i) => {
      points.push({
        id: generatePointId(idStr, "desc", i),
        text,
        embedding: desc.embeddings[i],
        documentId: idStr,
      });
    });

    // Attachment chunks
    att.chunks.forEach((text, i) => {
      points.push({
        id: generatePointId(idStr, "att", i),
        text,
        embedding: att.embeddings[i],
        documentId: idStr,
      });
    });

    await qdrantService.upsertGeneralChunks(points);
  }

  // Update chunkCount on Info record
  await Info.findByIdAndUpdate(infoId, { chunkCount: totalChunks });

  console.log(
    `[infoChunking] synced info ${idStr}: ${totalChunks} chunks (${desc.chunks.length} desc + ${att.chunks.length} att)`
  );
  return totalChunks;
}

/**
 * Delete all chunks for an info record from Qdrant.
 */
async function deleteInfoChunks(infoId: string): Promise<void> {
  await qdrantService.deleteGeneralByDocumentId(infoId.toString());
}

export { syncInfoChunks, deleteInfoChunks };
