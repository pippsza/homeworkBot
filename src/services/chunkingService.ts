import { generateText } from "ai";
import { createModel } from "./aiService";

const promptService = require("./promptService");

const CHUNK_SIZE = 1500; // characters
const CHUNK_OVERLAP = 200;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      const slice = text.slice(start, end + 100);
      const lastParagraph = slice.lastIndexOf("\n\n");
      if (lastParagraph > CHUNK_SIZE * 0.5) {
        end = start + lastParagraph + 2;
      } else {
        const lastSentence = slice.lastIndexOf(". ");
        if (lastSentence > CHUNK_SIZE * 0.5) {
          end = start + lastSentence + 2;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }

  return chunks.filter((c) => c.length > 20);
}

async function parseFile(buffer: Buffer, mimetype: string, originalname: string): Promise<string> {
  if (mimetype === "application/pdf") {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    return await parser.getText();
  }

  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimetype === "application/msword"
  ) {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype.startsWith("text/")) {
    return buffer.toString("utf-8");
  }

  if (mimetype.startsWith("image/")) {
    return parseImage(buffer, mimetype);
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}

async function parseImage(buffer: Buffer, mimetype: string = "image/jpeg"): Promise<string> {
  const ocrPrompt: string | null = await promptService.getPrompt("ocr");

  const { text } = await generateText({
    model: await createModel("flash"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: buffer,
            mimeType: mimetype,
          } as any,
          {
            type: "text",
            text:
              ocrPrompt ||
              "Extract all text from this image. Preserve structure.",
          },
        ],
      },
    ],
  });

  return text;
}

export { chunkText, parseFile, parseImage };
