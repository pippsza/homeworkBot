const { QdrantClient } = require("@qdrant/js-client-rest");

const VECTOR_SIZE = 3072;

let client = null;

function getClient() {
  if (!client) {
    client = new QdrantClient({
      url: process.env.QDRANT_URL || "http://localhost:6333",
    });
  }
  return client;
}

function collectionName(subjectId) {
  return `subject_${subjectId}`;
}

async function ensureCollection(subjectId) {
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

async function upsertChunks(subjectId, chunks) {
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

async function search(subjectId, queryEmbedding, limit = 5) {
  const qdrant = getClient();
  const name = collectionName(subjectId);

  const results = await qdrant.search(name, {
    vector: queryEmbedding,
    limit,
    with_payload: true,
  });

  return results.map((r) => ({
    text: r.payload.text,
    score: r.score,
    documentId: r.payload.documentId,
  }));
}

async function deleteByDocumentId(subjectId, documentId) {
  const qdrant = getClient();
  const name = collectionName(subjectId);

  await qdrant.delete(name, {
    filter: {
      must: [{ key: "documentId", match: { value: documentId } }],
    },
  });
}

async function getCollectionInfo(subjectId) {
  const qdrant = getClient();
  const name = collectionName(subjectId);

  try {
    const info = await qdrant.getCollection(name);
    return { pointsCount: info.points_count || 0 };
  } catch {
    return { pointsCount: 0 };
  }
}

// ── General knowledge collection (non-subject-scoped) ──

const GENERAL_COLLECTION = "general_knowledge";

async function ensureGeneralCollection() {
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

async function upsertGeneralChunks(chunks) {
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

async function searchGeneral(queryEmbedding, limit = 5) {
  const qdrant = getClient();
  try {
    const results = await qdrant.search(GENERAL_COLLECTION, {
      vector: queryEmbedding,
      limit,
      with_payload: true,
    });
    return results.map((r) => ({
      text: r.payload.text,
      score: r.score,
      documentId: r.payload.documentId,
    }));
  } catch {
    return [];
  }
}

async function deleteGeneralByDocumentId(documentId) {
  const qdrant = getClient();
  try {
    await qdrant.delete(GENERAL_COLLECTION, {
      filter: {
        must: [{ key: "documentId", match: { value: documentId } }],
      },
    });
  } catch (e) {
    console.error("[qdrant] deleteGeneralByDocumentId error:", e.message);
  }
}

async function getGeneralCollectionInfo() {
  const qdrant = getClient();
  try {
    const info = await qdrant.getCollection(GENERAL_COLLECTION);
    return { pointsCount: info.points_count || 0 };
  } catch {
    return { pointsCount: 0 };
  }
}

module.exports = {
  // Subject-scoped
  ensureCollection,
  upsertChunks,
  search,
  deleteByDocumentId,
  getCollectionInfo,
  // General knowledge
  ensureGeneralCollection,
  upsertGeneralChunks,
  searchGeneral,
  deleteGeneralByDocumentId,
  getGeneralCollectionInfo,
};
