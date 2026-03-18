import * as fs from 'fs';
import * as path from 'path';

type PolicyShape = {
  version?: string;
  retrieve?: {
    top_k?: number;
    top_k_vec?: number;
    top_k_bm25?: number;
    fused_top_n?: number;
    rerank_top_m?: number;
    rrf_k?: number;
    min_score_threshold?: number;
  };
  context?: {
    token_budget?: number;
    max_chunks_per_source?: number;
    coverage_min_gain?: number;
  };
  generation?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
  };
  guardrails?: {
    abstain_threshold?: number;
    retrieve_timeout_ms?: number;
    rerank_timeout_ms?: number;
    llm_timeout_ms?: number;
  };
};

function parseScalar(rawValue: string): string | number {
  const trimmed = rawValue.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function loadPolicyYaml(): PolicyShape {
  const filePath = path.resolve(process.cwd(), 'config', 'policy.yaml');
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const root: Record<string, any> = {};
  let section: string | null = null;

  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = raw.trim();

    if (indent === 0 && line.includes(':') && !line.endsWith(':')) {
      const [key, ...rest] = line.split(':');
      root[key.trim()] = parseScalar(rest.join(':'));
      continue;
    }

    if (indent === 0 && line.endsWith(':')) {
      section = line.slice(0, -1);
      root[section] = {};
      continue;
    }

    if (indent === 2 && section && line.includes(':')) {
      const [key, ...rest] = line.split(':');
      root[section][key.trim()] = parseScalar(rest.join(':'));
    }
  }

  return root as PolicyShape;
}

const policy = loadPolicyYaml();

export const appConfig = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  policy: {
    version: String(policy.version ?? process.env.POLICY_VERSION ?? 'phase5-v1'),
  },
  chunk: {
    size: parseInt(process.env.CHUNK_SIZE ?? '500', 10),
    step: parseInt(process.env.CHUNK_STEP ?? '200', 10),
  },
  retrieve: {
    topK: Number(policy.retrieve?.top_k ?? process.env.RETRIEVE_TOP_K ?? 8),
    topKVec: Number(policy.retrieve?.top_k_vec ?? process.env.RETRIEVE_TOP_K_VEC ?? 50),
    topKBm25: Number(policy.retrieve?.top_k_bm25 ?? process.env.RETRIEVE_TOP_K_BM25 ?? 50),
    fusedTopN: Number(policy.retrieve?.fused_top_n ?? process.env.RETRIEVE_FUSED_TOP_N ?? 30),
    rerankTopM: Number(policy.retrieve?.rerank_top_m ?? process.env.RERANK_TOP_M ?? 8),
    rrfK: Number(policy.retrieve?.rrf_k ?? process.env.RETRIEVE_RRF_K ?? 60),
    minScoreThreshold: Number(policy.retrieve?.min_score_threshold ?? process.env.MIN_SCORE_THRESHOLD ?? 0.05),
    rerankModel:
      process.env.RERANK_MODEL ?? 'Xenova/bge-reranker-base',
  },
  context: {
    tokenBudget: Number(policy.context?.token_budget ?? process.env.MAX_CONTEXT_TOKENS ?? 2000),
    maxChunksPerSource: Number(policy.context?.max_chunks_per_source ?? process.env.MAX_CHUNKS_PER_SOURCE ?? 2),
    coverageMinGain: Number(policy.context?.coverage_min_gain ?? process.env.COVERAGE_MIN_GAIN ?? 0.05),
  },
  rag: {
    abstainThreshold: Number(policy.guardrails?.abstain_threshold ?? process.env.ABSTAIN_THRESHOLD ?? 0.35),
  },
  generation: {
    model: String(policy.generation?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    maxTokens: Number(policy.generation?.max_tokens ?? process.env.LLM_MAX_TOKENS ?? 1024),
    temperature: Number(policy.generation?.temperature ?? process.env.LLM_TEMPERATURE ?? 0),
  },
  guardrails: {
    retrieveTimeoutMs: Number(policy.guardrails?.retrieve_timeout_ms ?? process.env.RETRIEVE_TIMEOUT_MS ?? 500),
    rerankTimeoutMs: Number(policy.guardrails?.rerank_timeout_ms ?? process.env.RERANK_TIMEOUT_MS ?? 500),
    llmTimeoutMs: Number(policy.guardrails?.llm_timeout_ms ?? process.env.LLM_TIMEOUT_MS ?? 10000),
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: String(policy.generation?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    embeddingBaseUrl:
      process.env.EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    embeddingApiKey:
      process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    embeddingModel:
      process.env.EMBEDDING_MODEL ?? process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    maxTokens: Number(policy.generation?.max_tokens ?? process.env.LLM_MAX_TOKENS ?? 1024),
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
