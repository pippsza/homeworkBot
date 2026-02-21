const { Router } = require("express");
const multer = require("multer");
const userService = require("../../services/userService");
const qdrantService = require("../../services/qdrantService");
const embeddingService = require("../../services/embeddingService");
const chunkingService = require("../../services/chunkingService");
const KnowledgeDocument = require("../../models/KnowledgeDocument");

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function requireSuperadmin(req, res, next) {
  const username = `@${req.telegramUser?.username}`;
  if (!(await userService.isSuperadmin(username))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Upload a file to knowledge base
router.post("/:subjectId/upload", requireSuperadmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File required" });

    const { subjectId } = req.params;
    const userId = req.telegramUser?.id;

    // Parse file to text
    const text = await chunkingService.parseFile(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from file" });
    }

    // Chunk the text
    const chunks = chunkingService.chunkText(text);

    // Create document record
    const doc = await KnowledgeDocument.create({
      subjectId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      chunkCount: chunks.length,
      uploadedBy: userId,
    });

    // Embed chunks
    const embeddings = await embeddingService.embedTexts(chunks);

    // Ensure collection exists and upsert
    await qdrantService.ensureCollection(subjectId);
    await qdrantService.upsertChunks(
      subjectId,
      chunks.map((text, i) => ({
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
  } catch (e) {
    console.error("[knowledge upload] error:", e);
    res.status(500).json({ error: e.message || "Upload failed" });
  }
});

// Upload text directly
router.post("/:subjectId/text", requireSuperadmin, async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Text too short" });
    }

    const { subjectId } = req.params;
    const userId = req.telegramUser?.id;

    const chunks = chunkingService.chunkText(text);

    const doc = await KnowledgeDocument.create({
      subjectId,
      filename: title || "Text input",
      mimetype: "text/plain",
      chunkCount: chunks.length,
      uploadedBy: userId,
    });

    const embeddings = await embeddingService.embedTexts(chunks);

    await qdrantService.ensureCollection(subjectId);
    await qdrantService.upsertChunks(
      subjectId,
      chunks.map((text, i) => ({
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
  } catch (e) {
    console.error("[knowledge text] error:", e);
    res.status(500).json({ error: e.message || "Failed" });
  }
});

// Get documents for a subject
router.get("/:subjectId", requireSuperadmin, async (req, res) => {
  const docs = await KnowledgeDocument.find({
    subjectId: req.params.subjectId,
  }).sort({ createdAt: -1 });

  const info = await qdrantService.getCollectionInfo(req.params.subjectId);

  res.json({ documents: docs, totalChunks: info.pointsCount });
});

// Delete a document
router.delete("/:subjectId/:documentId", requireSuperadmin, async (req, res) => {
  const { subjectId, documentId } = req.params;

  const doc = await KnowledgeDocument.findByIdAndDelete(documentId);
  if (!doc) return res.status(404).json({ error: "Not found" });

  await qdrantService
    .deleteByDocumentId(subjectId, documentId)
    .catch((e) => console.error("[knowledge delete] qdrant error:", e.message));

  res.json({ success: true });
});

module.exports = router;
