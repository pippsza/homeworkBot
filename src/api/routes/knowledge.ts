import { Router, Response, NextFunction } from "express";
import multer from "multer";
import * as userService from "../../services/userService";
import * as qdrantService from "../../services/qdrantService";
import * as embeddingService from "../../services/embeddingService";
import * as chunkingService from "../../services/chunkingService";
import KnowledgeDocument from "../../models/KnowledgeDocument";
import { AuthRequest } from "../middleware/telegramAuth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function requireSuperadmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// Upload a file to knowledge base
router.post("/:subjectId/upload", requireSuperadmin, upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "File required" });
      return;
    }

    const subjectId = String(req.params.subjectId);
    const userId = req.telegramUser?.id ? Number(req.telegramUser.id) : undefined;

    // Parse file to text
    const text = await chunkingService.parseFile(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    if (!text || text.trim().length < 10) {
      res.status(400).json({ error: "Could not extract text from file" });
      return;
    }

    // Chunk the text
    const chunks = chunkingService.chunkText(text);

    // Create document record
    const doc: any = await KnowledgeDocument.create({
      subjectId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      chunkCount: chunks.length,
      uploadedBy: userId,
    } as any);

    // Embed chunks
    const embeddings = await embeddingService.embedTexts(chunks);

    // Ensure collection exists and upsert
    await qdrantService.ensureCollection(subjectId);
    await qdrantService.upsertChunks(
      subjectId,
      chunks.map((text: string, i: number) => ({
        id: parseInt(doc._id.toString().slice(-8), 16) * 1000 + i,
        text,
        embedding: embeddings[i],
        documentId: doc._id.toString(),
      }))
    );

    res.status(201).json({
      _id: doc._id,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
    });
  } catch (e: any) {
    console.error("[knowledge upload] error:", e);
    res.status(500).json({ error: e.message || "Upload failed" });
  }
});

// Upload text directly
router.post("/:subjectId/text", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  try {
    const { text, title } = req.body;
    if (!text || text.trim().length < 10) {
      res.status(400).json({ error: "Text too short" });
      return;
    }

    const subjectId = String(req.params.subjectId);
    const userId = req.telegramUser?.id ? Number(req.telegramUser.id) : undefined;

    const chunks = chunkingService.chunkText(text);

    const doc: any = await KnowledgeDocument.create({
      subjectId,
      filename: title || "Text input",
      mimetype: "text/plain",
      chunkCount: chunks.length,
      uploadedBy: userId,
    } as any);

    const embeddings = await embeddingService.embedTexts(chunks);

    await qdrantService.ensureCollection(subjectId);
    await qdrantService.upsertChunks(
      subjectId,
      chunks.map((text: string, i: number) => ({
        id: parseInt(doc._id.toString().slice(-8), 16) * 1000 + i,
        text,
        embedding: embeddings[i],
        documentId: doc._id.toString(),
      }))
    );

    res.status(201).json({
      _id: doc._id,
      filename: doc.filename,
      chunkCount: doc.chunkCount,
    });
  } catch (e: any) {
    console.error("[knowledge text] error:", e);
    res.status(500).json({ error: e.message || "Failed" });
  }
});

// Get documents for a subject
router.get("/:subjectId", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const docs = await KnowledgeDocument.find({
    subjectId: String(req.params.subjectId),
  }).sort({ createdAt: -1 });

  const info = await qdrantService.getCollectionInfo(String(req.params.subjectId));

  res.json({ documents: docs, totalChunks: info.pointsCount });
});

// Delete a document
router.delete("/:subjectId/:documentId", requireSuperadmin, async (req: AuthRequest, res: Response) => {
  const subjectId = String(req.params.subjectId);
  const documentId = String(req.params.documentId);

  const doc = await KnowledgeDocument.findByIdAndDelete(documentId);
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await qdrantService
    .deleteByDocumentId(subjectId, documentId)
    .catch((e: Error) => console.error("[knowledge delete] qdrant error:", e.message));

  res.json({ success: true });
});

export default router;
