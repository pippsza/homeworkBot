import { QDRANT_ENABLED } from "../config/features";
import { QdrantClient } from "@qdrant/js-client-rest";

const VECTOR_SIZE = 3072;

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: process.env.QDRANT_URL || "http://localhost:6333",
    });
  }
  return client;
}

function collectionName(subjectId: string): string {
  return `subject_${subjectId}`;
}

export async function ensureCollection(subjectId: string): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  const name = collectionName(subjectId);

  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === name);

  if (!exists) {
    await qdrant.createCollection(name, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
}

interface ChunkInput {
  id?: number;
  embedding: number[];
  text: string;
  documentId: string;
}

export async function upsertChunks(subjectId: string, chunks: ChunkInput[]): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  const name = collectionName(subjectId);

  const points = chunks.map((chunk, i) => ({
    id: chunk.id || Date.now() + i,
    vector: chunk.embedding,
    payload: {
      text: chunk.text,
      documentId: chunk.documentId,
      chunkIndex: i,
    },
  }));

  await qdrant.upsert(name, { points });
}

interface SearchResult {
  text: string;
  score: number;
  documentId: string;
}

export async function search(subjectId: string, queryEmbedding: number[], limit: number = 5): Promise<SearchResult[]> {
  if (!QDRANT_ENABLED) return [];
  const qdrant = getClient();
  const name = collectionName(subjectId);

  const results = await qdrant.search(name, {
    vector: queryEmbedding,
    limit,
    with_payload: true,
  });

  return results.map((r) => ({
    text: (r.payload as any).text,
    score: r.score,
    documentId: (r.payload as any).documentId,
  }));
}

export async function deleteByDocumentId(subjectId: string, documentId: string): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  const name = collectionName(subjectId);

  await qdrant.delete(name, {
    filter: {
      must: [{ key: "documentId", match: { value: documentId } }],
    },
  });
}

export async function getCollectionInfo(subjectId: string): Promise<{ pointsCount: number }> {
  if (!QDRANT_ENABLED) return { pointsCount: 0 };
  const qdrant = getClient();
  const name = collectionName(subjectId);

  try {
    const info = await qdrant.getCollection(name);
    return { pointsCount: (info.points_count as number) || 0 };
  } catch {
    return { pointsCount: 0 };
  }
}

// -- General knowledge collection (non-subject-scoped) --

const GENERAL_COLLECTION = "general_knowledge";

export async function ensureGeneralCollection(): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(
    (c) => c.name === GENERAL_COLLECTION
  );
  if (!exists) {
    await qdrant.createCollection(GENERAL_COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
}

export async function upsertGeneralChunks(chunks: ChunkInput[]): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  const points = chunks.map((chunk, i) => ({
    id: chunk.id || Date.now() + i,
    vector: chunk.embedding,
    payload: {
      text: chunk.text,
      documentId: chunk.documentId,
      chunkIndex: i,
    },
  }));
  await qdrant.upsert(GENERAL_COLLECTION, { points });
}

export async function searchGeneral(queryEmbedding: number[], limit: number = 5): Promise<SearchResult[]> {
  if (!QDRANT_ENABLED) return [];
  const qdrant = getClient();
  try {
    const results = await qdrant.search(GENERAL_COLLECTION, {
      vector: queryEmbedding,
      limit,
      with_payload: true,
    });
    return results.map((r) => ({
      text: (r.payload as any).text,
      score: r.score,
      documentId: (r.payload as any).documentId,
    }));
  } catch {
    return [];
  }
}

export async function deleteGeneralByDocumentId(documentId: string): Promise<void> {
  if (!QDRANT_ENABLED) return;
  const qdrant = getClient();
  try {
    await qdrant.delete(GENERAL_COLLECTION, {
      filter: {
        must: [{ key: "documentId", match: { value: documentId } }],
      },
    });
  } catch (e: any) {
    console.error("[qdrant] deleteGeneralByDocumentId error:", e.message);
  }
}

export async function getGeneralCollectionInfo(): Promise<{ pointsCount: number }> {
  if (!QDRANT_ENABLED) return { pointsCount: 0 };
  const qdrant = getClient();
  try {
    const info = await qdrant.getCollection(GENERAL_COLLECTION);
    return { pointsCount: (info.points_count as number) || 0 };
  } catch {
    return { pointsCount: 0 };
  }
}
