import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Subject from "./models/Subject";
import Info from "./models/Info";
import Settings from "./models/Settings";
import ChatMessages from "./models/ChatMessages";

const DATA_PATH = path.join(__dirname, "data.json");

interface AttachmentData {
  type?: string;
  file_id?: string;
  content?: string;
}

interface TaskData {
  title: string;
  emoji?: string;
  description?: string;
  attachments?: (string | AttachmentData)[];
  answers?: (string | AttachmentData)[];
}

interface SubjectData {
  name: string;
  emoji?: string;
  lecturerName?: string;
  lecturerContact?: string;
  practitionerName?: string;
  practitionerContact?: string;
  tasks?: TaskData[];
}

interface InfoData {
  title: string;
  emoji?: string;
  description?: string;
  attachments?: (string | AttachmentData)[];
}

interface MigrationData {
  users?: {
    ADMINS?: string[];
    ANSWER_VIEWERS?: string[];
    SUPERUSERS?: string[];
  };
  subjects?: SubjectData[];
  infos?: InfoData[];
  chatMessages?: Record<string, number[]>;
}

async function migrate(): Promise<void> {
  const uri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("[migrate] Connected to MongoDB:", uri);

  if (!fs.existsSync(DATA_PATH)) {
    console.error("[migrate] data.json not found at", DATA_PATH);
    process.exit(1);
  }

  const data: MigrationData = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (Settings as any).create({
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
      emoji: s.emoji || "\u{1F4DA}",
      lecturerName: s.lecturerName || "",
      lecturerContact: s.lecturerContact || "",
      practitionerName: s.practitionerName || "",
      practitionerContact: s.practitionerContact || "",
      order: i,
      tasks: (s.tasks || []).map((t) => ({
        title: t.title,
        emoji: t.emoji || "\u{1F4C4}",
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
      emoji: info.emoji || "\u2139\uFE0F",
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

migrate().catch((e: unknown) => {
  console.error("[migrate] Error:", e);
  process.exit(1);
});
