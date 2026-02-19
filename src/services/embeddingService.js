const { createGoogleGenerativeAI } = require("@ai-sdk/google");
const { embedMany, embed } = require("ai");

function getEmbeddingModel() {
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google.textEmbeddingModel("gemini-embedding-001");
}

async function embedText(text) {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });
  return embedding;
}

async function embedTexts(texts) {
  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: texts,
  });
  return embeddings;
}

module.exports = { embedText, embedTexts };
