import * as fs from 'fs';
import * as path from 'path';

type QueryRiskAction = 'clarify' | 'abstain' | 'allow_with_warning';
type GuardrailRuleType = 'keyword' | 'regex' | 'phrase';
type EnforcementMode = 'lenient' | 'balanced' | 'strict';

type RawGuardrailRule = {
  id?: string;
  name?: string;
  type?: string;
  pattern?: string;
  weight?: number;
  action?: string;
  case_sensitive?: boolean;
};

type NormalizedGuardrailRule = {
  id: string;
  type: GuardrailRuleType;
  pattern: string;
  weight: number;
  action: QueryRiskAction;
  caseSensitive: boolean;
};

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
    lexical_signal?: {
      min_bm25_score?: number;
      min_bm25_hits?: number;
      min_rrf_score?: number;
    };
  };
  context?: {
    max_context_tokens?: number;
    token_budget?: number;
    max_chunks_per_source?: number;
    min_selected_chunks?: number;
    min_incremental_coverage?: number;
  };
  generation?: {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    answer_strategy?: string;
    require_citations?: boolean;
    max_evidence_points?: number;
    direct_grounded_answer_rule_template?: string;
    cautious_grounded_answer_rule_template?: string;
    clarify_message_template?: string;
    abstain_message_template?: string;
  };
  guardrails?: {
    abstain_threshold?: number;
    retrieve_timeout_ms?: number;
    rerank_timeout_ms?: number;
    llm_timeout_ms?: number;
    enforcement_mode?: string;
    sensitive_patterns?: RawGuardrailRule[];
    risk_intents?: RawGuardrailRule[];
  };
};

type ParsedYamlLine = {
  indent: number;
  content: string;
};

function parseScalar(rawValue: string): string | number {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return 1;
  }
  if (trimmed === 'false') {
    return 0;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function toParsedYamlLines(rawYaml: string): ParsedYamlLine[] {
  return rawYaml
    .split(/\r?\n/)
    .map((raw) => ({
      indent: raw.match(/^\s*/)?.[0].length ?? 0,
      content: raw.trim(),
    }))
    .filter((line) => line.content && !line.content.startsWith('#'));
}

function parseYamlBlock(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number,
): [unknown, number] {
  if (startIndex >= lines.length) {
    return [{}, startIndex];
  }

  if (lines[startIndex].content.startsWith('- ')) {
    return parseYamlArray(lines, startIndex, indent);
  }

  return parseYamlObject(lines, startIndex, indent);
}

function parseYamlObject(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number,
): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || line.content.startsWith('- ')) {
      break;
    }
    if (line.indent > indent) {
      index += 1;
      continue;
    }

    const separatorIndex = line.content.indexOf(':');
    if (separatorIndex === -1) {
      index += 1;
      continue;
    }

    const key = line.content.slice(0, separatorIndex).trim();
    const rawValue = line.content.slice(separatorIndex + 1).trim();

    if (rawValue) {
      result[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine || nextLine.indent <= line.indent) {
      result[key] = {};
      index += 1;
      continue;
    }

    const [child, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
    result[key] = child;
    index = nextIndex;
  }

  return [result, index];
}

function parseYamlArray(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number,
): [unknown[], number] {
  const result: unknown[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent || !line.content.startsWith('- ')) {
      break;
    }

    const itemContent = line.content.slice(2).trim();
    if (!itemContent) {
      const nextLine = lines[index + 1];
      if (!nextLine || nextLine.indent <= line.indent) {
        result.push({});
        index += 1;
        continue;
      }

      const [child, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
      result.push(child);
      index = nextIndex;
      continue;
    }

    const separatorIndex = itemContent.indexOf(':');
    if (separatorIndex === -1) {
      result.push(parseScalar(itemContent));
      index += 1;
      continue;
    }

    const item: Record<string, unknown> = {};
    const key = itemContent.slice(0, separatorIndex).trim();
    const rawValue = itemContent.slice(separatorIndex + 1).trim();

    if (rawValue) {
      item[key] = parseScalar(rawValue);
    } else {
      const nextLine = lines[index + 1];
      if (nextLine && nextLine.indent > line.indent) {
        const [child, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
        item[key] = child;
        index = nextIndex - 1;
      } else {
        item[key] = {};
      }
    }

    index += 1;

    while (index < lines.length) {
      const extraLine = lines[index];
      if (extraLine.indent <= indent || extraLine.content.startsWith('- ')) {
        break;
      }

      const extraSeparatorIndex = extraLine.content.indexOf(':');
      if (extraSeparatorIndex === -1) {
        index += 1;
        continue;
      }

      const extraKey = extraLine.content.slice(0, extraSeparatorIndex).trim();
      const extraRawValue = extraLine.content.slice(extraSeparatorIndex + 1).trim();

      if (extraRawValue) {
        item[extraKey] = parseScalar(extraRawValue);
        index += 1;
        continue;
      }

      const nextLine = lines[index + 1];
      if (!nextLine || nextLine.indent <= extraLine.indent) {
        item[extraKey] = {};
        index += 1;
        continue;
      }

      const [child, nextIndex] = parseYamlBlock(lines, index + 1, nextLine.indent);
      item[extraKey] = child;
      index = nextIndex;
    }

    result.push(item);
  }

  return [result, index];
}

function defaultGuardrailWeight(action: QueryRiskAction): number {
  if (action === 'abstain') {
    return 5;
  }
  if (action === 'clarify') {
    return 3;
  }
  return 1;
}

function toGuardrailType(type: unknown): GuardrailRuleType | null {
  if (type === 'keyword' || type === 'regex' || type === 'phrase') {
    return type;
  }
  return null;
}

function toGuardrailAction(action: unknown): QueryRiskAction | null {
  if (action === 'clarify' || action === 'abstain' || action === 'allow_with_warning') {
    return action;
  }
  return null;
}

function normalizeStructuredGuardrailRules(
  rawRules: RawGuardrailRule[] | undefined,
  fallbackIdPrefix: string,
): NormalizedGuardrailRule[] {
  return (rawRules ?? []).flatMap((rule, index) => {
    const type = toGuardrailType(rule?.type);
    const action = toGuardrailAction(rule?.action);
    const pattern = typeof rule?.pattern === 'string' ? rule.pattern.trim() : '';

    if (!type || !action || !pattern) {
      return [];
    }

    const rawWeight =
      typeof rule?.weight === 'number'
        ? rule.weight
        : typeof rule?.weight === 'string'
          ? Number(rule.weight)
          : defaultGuardrailWeight(action);
    const weight = Number.isFinite(rawWeight) ? Math.max(1, Number(rawWeight)) : 1;
    const rawId =
      typeof rule?.id === 'string' && rule.id.trim()
        ? rule.id.trim()
        : typeof rule?.name === 'string' && rule.name.trim()
          ? rule.name.trim()
          : `${fallbackIdPrefix}_${index + 1}`;

    return [
      {
        id: rawId,
        type,
        pattern,
        weight,
        action,
        caseSensitive: toBoolean(rule?.case_sensitive, false),
      },
    ];
  });
}

function loadPolicyYaml(): PolicyShape {
  const filePath = [
    path.resolve(process.cwd(), 'config', 'policy.yaml'),
    path.resolve(process.cwd(), 'server', 'config', 'policy.yaml'),
  ].find((candidate) => fs.existsSync(candidate));

  if (!filePath) {
    return {};
  }

  const parsedLines = toParsedYamlLines(fs.readFileSync(filePath, 'utf-8'));
  if (!parsedLines.length) {
    return {};
  }

  const [root] = parseYamlBlock(parsedLines, 0, parsedLines[0].indent);
  return (root as PolicyShape) ?? {};
}

const policy = loadPolicyYaml();
const sensitivePatterns = normalizeStructuredGuardrailRules(
  policy.guardrails?.sensitive_patterns,
  'sensitive_pattern',
);
const riskIntents = normalizeStructuredGuardrailRules(
  policy.guardrails?.risk_intents,
  'risk_intent',
);
const maxContextTokens = Number(
  policy.context?.max_context_tokens ??
    policy.context?.token_budget ??
    process.env.MAX_CONTEXT_TOKENS ??
    2000,
);
const lexicalSignalMinBm25Score = Number(
  policy.retrieve?.lexical_signal?.min_bm25_score ??
    process.env.LEXICAL_SIGNAL_MIN_BM25_SCORE ??
    0.01,
);
const lexicalSignalMinBm25Hits = Math.max(
  1,
  Number(
    policy.retrieve?.lexical_signal?.min_bm25_hits ??
      process.env.LEXICAL_SIGNAL_MIN_BM25_HITS ??
      1,
  ),
);
const lexicalSignalMinRrfScore = Number(
  policy.retrieve?.lexical_signal?.min_rrf_score ??
    process.env.LEXICAL_SIGNAL_MIN_RRF_SCORE ??
    0.03,
);
const minIncrementalCoverage = Number(
  policy.context?.min_incremental_coverage ??
    process.env.CONTEXT_MIN_INCREMENTAL_COVERAGE ??
    0.05,
);
const enforcementMode = (
  policy.guardrails?.enforcement_mode ??
  process.env.GUARDRAIL_ENFORCEMENT_MODE ??
  'balanced'
) as EnforcementMode;

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
    minScoreThreshold: Number(
      policy.retrieve?.min_score_threshold ?? process.env.MIN_SCORE_THRESHOLD ?? 0.05,
    ),
    lexicalSignal: {
      minBm25Score: lexicalSignalMinBm25Score,
      minBm25Hits: lexicalSignalMinBm25Hits,
      minRrfScore: lexicalSignalMinRrfScore,
    },
    rerankModel: process.env.RERANK_MODEL ?? 'Xenova/bge-reranker-base',
  },
  context: {
    maxContextTokens,
    tokenBudget: maxContextTokens,
    maxChunksPerSource: Number(
      policy.context?.max_chunks_per_source ?? process.env.MAX_CHUNKS_PER_SOURCE ?? 2,
    ),
    minSelectedChunks: Number(
      policy.context?.min_selected_chunks ?? process.env.MIN_SELECTED_CHUNKS ?? 3,
    ),
    minIncrementalCoverage,
  },
  rag: {
    abstainThreshold: Number(
      policy.guardrails?.abstain_threshold ?? process.env.ABSTAIN_THRESHOLD ?? 0.35,
    ),
  },
  generation: {
    model: String(policy.generation?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    maxTokens: Number(policy.generation?.max_tokens ?? process.env.LLM_MAX_TOKENS ?? 1024),
    temperature: Number(policy.generation?.temperature ?? process.env.LLM_TEMPERATURE ?? 0),
    answerStrategy: String(
      policy.generation?.answer_strategy ??
        process.env.GENERATION_ANSWER_STRATEGY ??
        'direct_grounded',
    ),
    requireCitations: toBoolean(
      policy.generation?.require_citations ?? process.env.GENERATION_REQUIRE_CITATIONS,
      true,
    ),
    maxEvidencePoints: Number(
      policy.generation?.max_evidence_points ??
        process.env.GENERATION_MAX_EVIDENCE_POINTS ??
        4,
    ),
    directGroundedAnswerRuleTemplate: String(
      policy.generation?.direct_grounded_answer_rule_template ??
        process.env.GENERATION_DIRECT_GROUNDED_ANSWER_RULE_TEMPLATE ??
        '1. 先直接回答用户问题，优先总结“根本原因 / 关键结论 / 核心步骤”，不要先说资料不足。',
    ),
    cautiousGroundedAnswerRuleTemplate: String(
      policy.generation?.cautious_grounded_answer_rule_template ??
        process.env.GENERATION_CAUTIOUS_GROUNDED_ANSWER_RULE_TEMPLATE ??
        '1. 先说明当前证据能确认的结论范围，再回答用户问题；如果证据不能覆盖关键前提，要明确指出。',
    ),
    clarifyMessageTemplate: String(
      policy.generation?.clarify_message_template ??
        process.env.GENERATION_CLARIFY_MESSAGE_TEMPLATE ??
        '当前知识库中未找到与「{{question}}」相关的证据。建议：① 上传相关文档后重新提问；② 换一种表述方式。',
    ),
    abstainMessageTemplate: String(
      policy.generation?.abstain_message_template ??
        process.env.GENERATION_ABSTAIN_MESSAGE_TEMPLATE ??
        '当前知识库中关于「{{question}}」的证据不足，且该问题可能涉及高风险判断。基于现有资料我不能直接下结论，建议补充更权威的文档后再提问。',
    ),
  },
  guardrails: {
    retrieveTimeoutMs: Number(
      policy.guardrails?.retrieve_timeout_ms ?? process.env.RETRIEVE_TIMEOUT_MS ?? 500,
    ),
    rerankTimeoutMs: Number(
      policy.guardrails?.rerank_timeout_ms ?? process.env.RERANK_TIMEOUT_MS ?? 500,
    ),
    llmTimeoutMs: Number(
      policy.guardrails?.llm_timeout_ms ?? process.env.LLM_TIMEOUT_MS ?? 10000,
    ),
    enforcementMode:
      enforcementMode === 'lenient' || enforcementMode === 'strict'
        ? enforcementMode
        : 'balanced',
    sensitivePatterns,
    riskIntents,
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: String(policy.generation?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    embeddingBaseUrl:
      process.env.EMBEDDING_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1',
    embeddingApiKey: process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    embeddingModel:
      process.env.EMBEDDING_MODEL ??
      process.env.OPENAI_EMBEDDING_MODEL ??
      'text-embedding-3-small',
    maxTokens: Number(policy.generation?.max_tokens ?? process.env.LLM_MAX_TOKENS ?? 1024),
    temperature: Number(policy.generation?.temperature ?? process.env.LLM_TEMPERATURE ?? 0),
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
