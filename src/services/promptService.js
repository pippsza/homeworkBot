const fs = require("fs");
const path = require("path");
const Prompt = require("../models/Prompt");

const PROMPTS_DIR = path.join(__dirname, "../prompts");

const PROMPT_DESCRIPTIONS = {
  "chat-system": "System prompt for AI chat",
  "auto-solve": "Prompt for auto-solving tasks",
  orchestrator: "Orchestrator prompt (decides if RAG is needed)",
  ocr: "OCR prompt for extracting text from images",
};

async function getPrompt(key) {
  // Try MongoDB first
  const doc = await Prompt.findOne({ key });
  if (doc) return doc.content;

  // Fallback to file
  const filePath = path.join(PROMPTS_DIR, `${key}.txt`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }

  return null;
}

async function getAllPrompts() {
  // Get all from MongoDB
  const docs = await Prompt.find().sort({ key: 1 });
  const result = new Map(docs.map((d) => [d.key, d]));

  // Add any file-only prompts not yet in DB
  if (fs.existsSync(PROMPTS_DIR)) {
    for (const file of fs.readdirSync(PROMPTS_DIR)) {
      if (!file.endsWith(".txt")) continue;
      const key = file.replace(".txt", "");
      if (!result.has(key)) {
        const content = fs.readFileSync(path.join(PROMPTS_DIR, file), "utf-8");
        result.set(key, {
          key,
          content,
          description: PROMPT_DESCRIPTIONS[key] || "",
          updatedAt: null,
        });
      }
    }
  }

  return [...result.values()];
}

async function updatePrompt(key, content) {
  return Prompt.findOneAndUpdate(
    { key },
    { content },
    { upsert: true, returnDocument: "after" }
  );
}

async function syncFromFiles() {
  if (!fs.existsSync(PROMPTS_DIR)) return { synced: 0 };

  let synced = 0;
  for (const file of fs.readdirSync(PROMPTS_DIR)) {
    if (!file.endsWith(".txt")) continue;
    const key = file.replace(".txt", "");
    const content = fs.readFileSync(path.join(PROMPTS_DIR, file), "utf-8");
    await Prompt.findOneAndUpdate(
      { key },
      { content, description: PROMPT_DESCRIPTIONS[key] || "" },
      { upsert: true }
    );
    synced++;
  }

  return { synced };
}

module.exports = { getPrompt, getAllPrompts, updatePrompt, syncFromFiles };
