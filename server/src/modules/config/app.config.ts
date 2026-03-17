export const appConfig = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  chunk: {
    size: parseInt(process.env.CHUNK_SIZE ?? '500', 10),
    step: parseInt(process.env.CHUNK_STEP ?? '200', 10),
  },
  retrieve: {
    topK: parseInt(process.env.RETRIEVE_TOP_K ?? '8', 10),
    topKVec: parseInt(process.env.RETRIEVE_TOP_K_VEC ?? '50', 10),
    topKBm25: parseInt(process.env.RETRIEVE_TOP_K_BM25 ?? '50', 10),
    fusedTopN: parseInt(process.env.RETRIEVE_FUSED_TOP_N ?? '30', 10),
    rerankTopM: parseInt(process.env.RERANK_TOP_M ?? '8', 10),
    rrfK: parseInt(process.env.RETRIEVE_RRF_K ?? '60', 10),
    rerankModel:
      process.env.RERANK_MODEL ?? 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  },
  context: {
    tokenBudget: parseInt(process.env.MAX_CONTEXT_TOKENS ?? '2000', 10),
    maxChunksPerSource: parseInt(process.env.MAX_CHUNKS_PER_SOURCE ?? '2', 10),
    coverageMinGain: parseFloat(process.env.COVERAGE_MIN_GAIN ?? '0.05'),
  },
  rag: {
    abstainThreshold: parseFloat(process.env.ABSTAIN_THRESHOLD ?? '0.35'),
  },
  guardrails: {
    retrieveTimeoutMs: parseInt(process.env.RETRIEVE_TIMEOUT_MS ?? '500', 10),
    rerankTimeoutMs: parseInt(process.env.RERANK_TIMEOUT_MS ?? '500', 10),
    llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS ?? '10000', 10),
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? '1024', 10),
  },
  vectorStore: process.env.VECTOR_STORE ?? 'memory',
  trace: {
    logDir: process.env.TRACE_LOG_DIR ?? '',
  },
  schedule: {
    timezone: process.env.SCHEDULE_TIMEZONE ?? 'Asia/Shanghai',
    reviewCron: process.env.REVIEW_CRON ?? '0 20 * * *',
  },
});
