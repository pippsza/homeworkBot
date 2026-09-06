import { QDRANT_ENABLED } from "../config/features";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany, embed } from "ai";

function getEmbeddingModel() {
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google.textEmbeddingModel("gemini-embedding-001");
}

export async function embedText(text: string): Promise<number[]> {
  if (!QDRANT_ENABLED) return [];
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!QDRANT_ENABLED) return texts.map(() => []);
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: texts,
  });
  return embeddings;
}
