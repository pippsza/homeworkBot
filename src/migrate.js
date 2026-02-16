require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Subject = require("./models/Subject");
const Info = require("./models/Info");
const Settings = require("./models/Settings");
const ChatMessages = require("./models/ChatMessages");

const DATA_PATH = path.join(__dirname, "data.json");

async function migrate() {
  const uri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("[migrate] Connected to MongoDB:", uri);

  if (!fs.existsSync(DATA_PATH)) {
    console.error("[migrate] data.json not found at", DATA_PATH);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

  // Check if already migrated
  const existingSubjects = await Subject.countDocuments();
  if (existingSubjects > 0) {
    console.log(
      "[migrate] Database already has data. Skipping. Drop collections first if you want to re-migrate."
    );
    await mongoose.disconnect();
    return;
  }

  // Migrate settings
  const users = data.users || {
    ADMINS: ["@pippsza"],
    ANSWER_VIEWERS: ["@pippsza"],
    SUPERUSERS: ["@pippsza"],
  };
  await Settings.create({
    key: "main",
    admins: users.ADMINS || [],
    answerViewers: users.ANSWER_VIEWERS || [],
    superusers: users.SUPERUSERS || [],
  });
  console.log("[migrate] Settings migrated");

  // Migrate subjects
  for (const [i, s] of (data.subjects || []).entries()) {
    const subjectData = {
      name: s.name,
      emoji: s.emoji || "📚",
      lecturerName: s.lecturerName || "",
      lecturerContact: s.lecturerContact || "",
      practitionerName: s.practitionerName || "",
      practitionerContact: s.practitionerContact || "",
      order: i,
      tasks: (s.tasks || []).map((t) => ({
        title: t.title,
        emoji: t.emoji || "📄",
        description: t.description || "",
        attachments: (t.attachments || []).map((a) => {
          if (typeof a === "string") {
            return { type: "document", file_id: a };
          }
          return {
            type: a.type || "document",
            file_id: a.file_id || a.content || "",
          };
        }),
        answers: (t.answers || []).map((a) => {
          if (typeof a === "string") {
            return { type: "text", content: a, file_id: "" };
          }
          return {
            type: a.type || "text",
            content: a.content || "",
            file_id: a.file_id || (a.type !== "text" ? a.content : "") || "",
          };
        }),
      })),
    };
    await Subject.create(subjectData);
    console.log(`[migrate] Subject "${s.name}" migrated with ${s.tasks?.length || 0} tasks`);
  }

  // Migrate infos
  for (const [i, info] of (data.infos || []).entries()) {
    await Info.create({
      title: info.title,
      emoji: info.emoji || "ℹ️",
      description: info.description || "",
      order: i,
      attachments: (info.attachments || []).map((a) => {
        if (typeof a === "string") {
          return { type: "document", file_id: a };
        }
        return {
          type: a.type || "document",
          file_id: a.file_id || "",
        };
      }),
    });
    console.log(`[migrate] Info "${info.title}" migrated`);
  }

  // Migrate chatMessages
  for (const [chatId, messageIds] of Object.entries(
    data.chatMessages || {}
  )) {
    if (messageIds && messageIds.length > 0) {
      await ChatMessages.create({ chatId, messageIds });
    }
  }
  console.log("[migrate] ChatMessages migrated");

  console.log("[migrate] Migration complete!");
  await mongoose.disconnect();
}

migrate().catch((e) => {
  console.error("[migrate] Error:", e);
  process.exit(1);
});
