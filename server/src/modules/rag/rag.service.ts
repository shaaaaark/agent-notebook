import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import * as crypto from 'crypto';
import { LlmProvider } from '../../providers/llm.provider';
import {
  ContextBuilderOutput,
  ContextBuilderService,
  SkippedChunk,
} from '../context/context-builder.service';
import { HybridRetrieverService } from '../retrieval/hybrid-retriever.service';
import type {
  KnowledgeBaseStatus,
  RetrievedChunk,
  RetrievalResult,
} from '../retrieval/retrieval.types';
import { RequestTrace, TraceChunkRecord, TraceService } from '../trace/trace.service';

export type RagSource = {
  chunk_id: string;
  source: string;
  score: number;
  snippet: string;
  score_vec?: number;
  score_bm25?: number;
  score_rrf?: number;
  rerank_score?: number;
  rank_vec?: number;
  rank_bm25?: number;
  rank_final?: number;
};

export type RagFinalStatus = 'success' | 'clarify' | 'abstain' | 'error';
type QueryRiskAction = 'clarify' | 'abstain' | 'allow_with_warning';
type QueryRiskRule = {
  id?: string;
  name?: string;
  type: 'keyword' | 'regex' | 'phrase';
  pattern: string;
  weight?: number;
  action: QueryRiskAction;
  caseSensitive?: boolean;
};

type PreparedResponse = {
  requestId: string;
  retrieval: RetrievalResult;
  context: ContextBuilderOutput;
  retrieveLatencyMs: number;
  finalStatus: RagFinalStatus;
  prompt: string;
  answer?: string;
  sources: RagSource[];
  queryRiskAction: QueryRiskAction | null;
};

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly llm: LlmProvider,
    private readonly config: ConfigService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly traceService: TraceService,
    private readonly retriever: HybridRetrieverService,
  ) {}

  async addDocuments(docs: Document[]) {
    await this.retriever.addDocuments(docs);
  }

  deleteBySource(source: string): number {
    return this.retriever.deleteBySource(source);
  }

  async rebuildIndex(docGroups?: Array<{ source: string; docs: Document[] }>) {
    await this.retriever.rebuildIndex(docGroups);
  }

  clearKnowledgeBase(): void {
    this.retriever.clear();
  }

  getKnowledgeBaseStatus(): KnowledgeBaseStatus {
    return this.retriever.getStatus();
  }

  private buildPrompt(question: string, contextText: string) {
    const answerStrategy =
      this.config.get<string>('generation.answerStrategy') ?? 'direct_grounded';
    const requireCitations =
      this.config.get<boolean>('generation.requireCitations') ?? true;
    const maxEvidencePoints = Math.max(
      2,
      this.config.get<number>('generation.maxEvidencePoints') ?? 4,
    );
    const answerRule =
      answerStrategy === 'cautious_grounded'
        ? this.config.get<string>(
            'generation.cautiousGroundedAnswerRuleTemplate',
          ) ??
          '1. 先说明当前证据能确认的结论范围，再回答用户问题；如果证据不能覆盖关键前提，要明确指出。'
        : this.config.get<string>(
            'generation.directGroundedAnswerRuleTemplate',
          ) ??
          '1. 先直接回答用户问题，优先总结“根本原因 / 关键结论 / 核心步骤”，不要先说资料不足。';
    const citationRule = requireCitations
      ? '3. 每个主要论点都要标注证据编号，如 [E1]、[E2]。'
      : '3. 引用证据编号是推荐项；若答案非常简短可不逐句标注，但不得脱离证据。';

    return `你是知识库助手。请严格基于以下证据回答，并遵守下面规则：
${answerRule}
2. 只要证据里存在可支撑的相关信息，就先给出当前可得结论；只有在证据完全不相关或明显缺失关键前提时，才说明局限。
${citationRule}
4. 不得编造证据中没有的信息；如果有不确定之处，用“根据现有证据，可以判断/更可能是”这种说法。
5. 回答结构尽量简洁：先给结论，再补 2-${maxEvidencePoints} 条依据，最后如有必要再说明局限。

${contextText}

问题：${question}`;
  }

  private toSources(docs: RetrievedChunk[]): RagSource[] {
    return docs.map((item) => ({
      chunk_id: String(item.doc.metadata.chunk_id ?? 'unknown'),
      source: String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
      score: Number(item.score.toFixed(4)),
      snippet: item.doc.pageContent.slice(0, 80),
      ...(item.scoreVec !== undefined
        ? { score_vec: Number(item.scoreVec.toFixed(4)) }
        : {}),
      ...(item.scoreBm25 !== undefined
        ? { score_bm25: Number(item.scoreBm25.toFixed(4)) }
        : {}),
      ...(item.scoreRrf !== undefined
        ? { score_rrf: Number(item.scoreRrf.toFixed(4)) }
        : {}),
      ...(item.rerankScore !== undefined
        ? { rerank_score: Number(item.rerankScore.toFixed(4)) }
        : {}),
      ...(item.rankVec !== undefined ? { rank_vec: item.rankVec } : {}),
      ...(item.rankBm25 !== undefined ? { rank_bm25: item.rankBm25 } : {}),
      ...(item.rankFinal !== undefined ? { rank_final: item.rankFinal } : {}),
    }));
  }

  private toTraceChunks(docs: RetrievedChunk[]): TraceChunkRecord[] {
    return docs.map((item) => ({
      chunk_id: String(item.doc.metadata.chunk_id ?? 'unknown'),
      source: String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
      score: Number(item.score.toFixed(4)),
      ...(item.scoreVec !== undefined
        ? { score_vec: Number(item.scoreVec.toFixed(4)) }
        : {}),
      ...(item.scoreBm25 !== undefined
        ? { score_bm25: Number(item.scoreBm25.toFixed(4)) }
        : {}),
      ...(item.scoreRrf !== undefined
        ? { score_rrf: Number(item.scoreRrf.toFixed(4)) }
        : {}),
      ...(item.rerankScore !== undefined
        ? { rerank_score: Number(item.rerankScore.toFixed(4)) }
        : {}),
      ...(item.rankVec !== undefined ? { rank_vec: item.rankVec } : {}),
      ...(item.rankBm25 !== undefined ? { rank_bm25: item.rankBm25 } : {}),
      ...(item.rankFinal !== undefined ? { rank_final: item.rankFinal } : {}),
    }));
  }

  private countSkippedReasons(skipped: SkippedChunk[]): Record<string, number> {
    return skipped.reduce<Record<string, number>>((acc, item) => {
      acc[item.reason] = (acc[item.reason] ?? 0) + 1;
      return acc;
    }, {});
  }

  private extractCitations(answer: string): string[] {
    return Array.from(new Set(answer.match(/\[E\d+\]/g) ?? []));
  }

  private hashAnswer(answer: string): string {
    return crypto.createHash('md5').update(answer).digest('hex');
  }

  private confidenceScore(chunk: RetrievedChunk): number {
    if (chunk.rerankScore !== undefined) {
      return chunk.rerankScore;
    }
    if (chunk.scoreRrf !== undefined) {
      return chunk.scoreRrf;
    }
    if (chunk.scoreVec !== undefined) {
      return chunk.scoreVec;
    }
    if (chunk.scoreBm25 !== undefined) {
      return chunk.scoreBm25;
    }
    return chunk.score;
  }

  private hasEnoughSignal(retrieval: RetrievalResult, threshold: number): boolean {
    if (!retrieval.chunks.length) {
      return false;
    }

    const weakSignalRatio =
      this.config.get<number>('guardrails.weakSignalRatio') ?? 0.35;
    const weakSignalFloor =
      this.config.get<number>('guardrails.weakSignalFloor') ?? 0.01;
    const weakSignalHits = Math.max(
      1,
      this.config.get<number>('guardrails.weakSignalHits') ?? 2,
    );
    const weakSignalWindow = Math.max(
      1,
      this.config.get<number>('guardrails.weakSignalWindow') ?? 3,
    );
    const lexicalSignalMinBm25Score =
      this.config.get<number>('retrieve.lexicalSignal.minBm25Score') ?? 0.01;
    const lexicalSignalMinBm25Hits = Math.max(
      1,
      this.config.get<number>('retrieve.lexicalSignal.minBm25Hits') ?? 1,
    );
    const lexicalSignalMinRrfScore =
      this.config.get<number>('retrieve.lexicalSignal.minRrfScore') ?? 0.03;
    const weakSignalLexicalThreshold =
      this.config.get<number>('guardrails.weakSignalLexicalThreshold') ?? 1;

    const topChunk = retrieval.chunks[0];
    const selectedSignal = [
      topChunk?.rerankScore,
      topChunk?.scoreRrf,
      topChunk?.scoreVec,
      topChunk?.scoreBm25,
      topChunk?.score,
    ].filter((value): value is number => typeof value === 'number');

    const hasLexicalSignal =
      retrieval.chunks.filter((item) => (item.scoreBm25 ?? 0) >= lexicalSignalMinBm25Score)
        .length >= lexicalSignalMinBm25Hits;
    const hasStrongTopChunk = selectedSignal.some(
      (value) => value >= threshold || value >= lexicalSignalMinRrfScore,
    );
    const hasMultipleWeakSignals =
      retrieval.chunks.slice(0, weakSignalWindow).filter((item) => {
        const signal =
          item.rerankScore ?? item.scoreRrf ?? item.scoreVec ?? item.score;
        return (
          signal >= Math.max(threshold * weakSignalRatio, weakSignalFloor) ||
          (item.scoreBm25 ?? 0) >= weakSignalLexicalThreshold
        );
      }).length >= weakSignalHits;

    if (retrieval.strategy === 'hybrid_rrf' || retrieval.strategy === 'hybrid_rrf_rerank') {
      return hasStrongTopChunk || hasLexicalSignal || hasMultipleWeakSignals;
    }

    if (retrieval.strategy === 'vector_only' && hasLexicalSignal) {
      return true;
    }

    return retrieval.chunks.some((item) => this.confidenceScore(item) >= threshold);
  }

  private getQueryRiskRules(): QueryRiskRule[] {
    const sensitivePatterns =
      this.config.get<QueryRiskRule[]>('guardrails.sensitivePatterns') ?? [];
    const riskIntents =
      this.config.get<QueryRiskRule[]>('guardrails.riskIntents') ?? [];

    return [...sensitivePatterns, ...riskIntents];
  }

  private matchesQueryRiskRule(rule: QueryRiskRule, question: string): boolean {
    const normalizedQuestion = rule.caseSensitive ? question : question.toLowerCase();
    const normalizedPattern = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();

    if (rule.type === 'keyword' || rule.type === 'phrase') {
      return normalizedQuestion.includes(normalizedPattern);
    }

    try {
      return new RegExp(rule.pattern, rule.caseSensitive ? undefined : 'i').test(question);
    } catch (error) {
      this.logger.warn(
        `Invalid query risk regex "${rule.id ?? rule.name ?? rule.pattern}": ${(error as Error).message}`,
      );
      return false;
    }
  }

  private resolveQueryRiskAction(question: string): QueryRiskAction | null {
    const matchedRules = this.getQueryRiskRules().filter((rule) =>
      this.matchesQueryRiskRule(rule, question),
    );
    if (!matchedRules.length) {
      return null;
    }

    const enforcementMode =
      this.config.get<string>('guardrails.enforcementMode') ?? 'balanced';
    const matchedScore = matchedRules.reduce(
      (sum, rule) => sum + Math.max(1, rule.weight ?? 1),
      0,
    );
    const actionScores = matchedRules.reduce<Record<QueryRiskAction, number>>(
      (acc, rule) => {
        acc[rule.action] += Math.max(1, rule.weight ?? 1);
        return acc;
      },
      {
        clarify: 0,
        abstain: 0,
        allow_with_warning: 0,
      },
    );

    if (actionScores.abstain >= 5) {
      return 'abstain';
    }

    if (enforcementMode === 'strict' && matchedScore >= 4) {
      return actionScores.abstain > 0 ? 'abstain' : 'clarify';
    }

    if (matchedScore >= 3 || actionScores.clarify >= 3) {
      return actionScores.abstain > 0 ? 'abstain' : 'clarify';
    }

    return 'allow_with_warning';
  }

  private getWarningMessage(): string {
    return '提示：以下内容仅基于当前知识库证据，不能替代专业判断。';
  }

  private applyQueryRiskAction(
    answer: string,
    action: QueryRiskAction | null,
  ): string {
    if (action !== 'allow_with_warning' || !answer.trim()) {
      return answer;
    }

    return `${this.getWarningMessage()}\n\n${answer}`;
  }

  private resolveLowConfidenceStatus(
    action: QueryRiskAction | null,
    canAbstain: boolean,
  ): Extract<RagFinalStatus, 'clarify' | 'abstain'> {
    if (action === 'abstain' && canAbstain) {
      return 'abstain';
    }

    return 'clarify';
  }

  private renderQuestionTemplate(template: string, question: string): string {
    return template.replaceAll('{{question}}', question);
  }

  private getClarifyMessage(question: string): string {
    const template =
      this.config.get<string>('generation.clarifyMessageTemplate') ??
      '当前知识库中未找到与「{{question}}」相关的证据。建议：① 上传相关文档后重新提问；② 换一种表述方式。';
    return this.renderQuestionTemplate(template, question);
  }

  private getAbstainMessage(question: string): string {
    const template =
      this.config.get<string>('generation.abstainMessageTemplate') ??
      '当前知识库中关于「{{question}}」的证据不足，且该问题可能涉及高风险判断。基于现有资料我不能直接下结论，建议补充更权威的文档后再提问。';
    return this.renderQuestionTemplate(template, question);
  }

  private async withTimeout<T>(
    executor: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        executor(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(message));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async prepareResponse(question: string): Promise<PreparedResponse> {
    const requestId = this.traceService.createRequestId();
    const topK = this.config.get<number>('retrieve.topK') ?? 8;
    const retrieveTimeoutMs = this.config.get<number>('guardrails.retrieveTimeoutMs') ?? 500;
    const maxContextTokens =
      this.config.get<number>('context.maxContextTokens') ??
      this.config.get<number>('context.tokenBudget') ??
      2000;
    const minScoreThreshold =
      this.config.get<number>('retrieve.minScoreThreshold') ?? 0.05;
    const abstainThreshold = this.config.get<number>('rag.abstainThreshold') ?? 0.35;
    const queryRiskAction = this.resolveQueryRiskAction(question);

    let retrieval: RetrievalResult = {
      chunks: [],
      strategy: 'vector_only',
      degraded: true,
      degradeReason: 'not_started',
    };
    let retrieveTimedOut = false;
    const retrieveStartedAt = Date.now();

    try {
      retrieval = await this.withTimeout(
        () => this.retriever.retrieve(question, { topK }),
        retrieveTimeoutMs,
        `Retrieve timed out after ${retrieveTimeoutMs}ms`,
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        retrieveTimedOut = true;
        this.logger.warn(error.message);
      } else {
        throw error;
      }
    }

    const retrieveLatencyMs = Date.now() - retrieveStartedAt;
    const context = this.contextBuilder.build({
      query: question,
      candidates: retrieval.chunks,
      tokenBudget: maxContextTokens,
    });
    const enoughSignal = this.hasEnoughSignal(retrieval, minScoreThreshold);
    const lowConfidence =
      retrieveTimedOut ||
      (!enoughSignal && context.selected.length === 0);

    if (lowConfidence) {
      const finalStatus = this.resolveLowConfidenceStatus(
        queryRiskAction,
        retrieveTimedOut || !this.hasEnoughSignal(retrieval, abstainThreshold),
      );
      const answer =
        finalStatus === 'abstain'
          ? this.getAbstainMessage(question)
          : this.getClarifyMessage(question);

      return {
        requestId,
        retrieval: {
          ...retrieval,
          degraded:
            retrieval.degraded || retrieveTimedOut || !retrieval.chunks.length,
          degradeReason:
            retrieval.degradeReason ??
            (retrieveTimedOut ? 'retrieve_timeout' : 'low_confidence'),
        },
        context,
        retrieveLatencyMs,
        finalStatus,
        prompt: '',
        answer,
        sources: this.toSources(context.selected),
        queryRiskAction,
      };
    }

    return {
      requestId,
      retrieval,
      context,
      retrieveLatencyMs,
      finalStatus: 'success',
      prompt: this.buildPrompt(question, context.contextText),
      sources: this.toSources(context.selected),
      queryRiskAction,
    };
  }

  private buildTrace(
    question: string,
    prepared: PreparedResponse,
    answer: string,
    generateLatencyMs: number,
    promptTokens: number,
    completionTokens: number,
    finalStatus: RagFinalStatus,
  ): RequestTrace {
    return {
      request_id: prepared.requestId,
      timestamp: new Date().toISOString(),
      policy_version: this.config.get<string>('policy.version') ?? 'phase5-v1',
      replay_input: {
        query: question,
        selected_chunk_ids: prepared.context.selected.map((item) =>
          String(item.doc.metadata.chunk_id ?? 'unknown'),
        ),
        retrieved_chunk_ids: prepared.retrieval.chunks.map((item) =>
          String(item.doc.metadata.chunk_id ?? 'unknown'),
        ),
        model: this.config.get<string>('openai.model') ?? 'unknown',
      },
      query_raw: question,
      retrieve_topK: this.config.get<number>('retrieve.topK') ?? 8,
      retrieval_strategy: prepared.retrieval.strategy,
      retrieve_degraded: prepared.retrieval.degraded,
      ...(prepared.retrieval.degradeReason
        ? { retrieve_degrade_reason: prepared.retrieval.degradeReason }
        : {}),
      retrieved_chunks: this.toTraceChunks(prepared.retrieval.chunks),
      retrieve_latency_ms: prepared.retrieveLatencyMs,
      selected_chunks: prepared.context.selected.map((item) =>
        String(item.doc.metadata.chunk_id ?? 'unknown'),
      ),
      selected_sources: prepared.context.selected.map((item) =>
        String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
      ),
      skipped_reasons: this.countSkippedReasons(prepared.context.skipped),
      token_used: prepared.context.stats.tokenUsed,
      truncated: prepared.context.stats.truncated,
      model: this.config.get<string>('openai.model') ?? 'unknown',
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      generate_latency_ms: generateLatencyMs,
      answer_hash: this.hashAnswer(answer),
      citations_parsed: this.extractCitations(answer),
      final_status: finalStatus,
    };
  }

  private normalizeError(error: unknown): {
    message: string;
    status?: number;
    detail?: unknown;
  } {
    if (error instanceof TimeoutError) {
      return {
        message: error.message,
        status: 504,
        detail: 'timeout',
      };
    }

    const err = error as Error & {
      status?: number;
      detail?: unknown;
      response?: { status?: number; data?: unknown };
      cause?: unknown;
    };

    return {
      message: err.message ?? 'Unknown error',
      status: err.status ?? err.response?.status,
      detail: err.detail ?? err.response?.data ?? err.cause ?? null,
    };
  }

  async retrieve(question: string, topK?: number): Promise<RetrievedChunk[]> {
    const result = await this.retriever.retrieve(question, { topK });
    return result.chunks;
  }

  async retrieveDetailed(question: string, topK?: number): Promise<RetrievalResult> {
    return this.retriever.retrieve(question, { topK });
  }

  async ask(question: string) {
    const prepared = await this.prepareResponse(question);

    if (prepared.finalStatus !== 'success') {
      const answer = prepared.answer ?? '';
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          answer,
          0,
          0,
          this.contextBuilder.estimateTokens(answer),
          prepared.finalStatus,
        ),
      );
      return {
        answer,
        sources: prepared.sources,
        finalStatus: prepared.finalStatus,
        requestId: prepared.requestId,
      };
    }

    const llmTimeoutMs = this.config.get<number>('guardrails.llmTimeoutMs') ?? 10000;
    const generateStartedAt = Date.now();

    try {
      const result = await this.withTimeout(
        (signal) => this.llm.complete(prepared.prompt, { signal }),
        llmTimeoutMs,
        `LLM timed out after ${llmTimeoutMs}ms`,
      );
      const answer = this.applyQueryRiskAction(
        result.content,
        prepared.queryRiskAction,
      );
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          answer,
          Date.now() - generateStartedAt,
          result.promptTokens || this.contextBuilder.estimateTokens(prepared.prompt),
          this.contextBuilder.estimateTokens(answer),
          'success',
        ),
      );
      return {
        answer,
        sources: prepared.sources,
        finalStatus: 'success' as const,
        requestId: prepared.requestId,
      };
    } catch (error) {
      const err = this.normalizeError(error);
      this.logger.error('LLM request failed', err);
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          '',
          Date.now() - generateStartedAt,
          this.contextBuilder.estimateTokens(prepared.prompt),
          0,
          'error',
        ),
      );
      return {
        error: {
          message: err.message,
          status: err.status,
          detail: err.detail ?? null,
        },
        requestId: prepared.requestId,
      };
    }
  }

  async askStream(question: string, onToken: (chunk: string) => void) {
    const prepared = await this.prepareResponse(question);

    if (prepared.finalStatus !== 'success') {
      const answer = prepared.answer ?? '';
      onToken(answer);
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          answer,
          0,
          0,
          this.contextBuilder.estimateTokens(answer),
          prepared.finalStatus,
        ),
      );
      return {
        sources: prepared.sources,
        finalStatus: prepared.finalStatus,
        requestId: prepared.requestId,
      };
    }

    const llmTimeoutMs = this.config.get<number>('guardrails.llmTimeoutMs') ?? 10000;
    const generateStartedAt = Date.now();

    try {
      const warningPrefix =
        prepared.queryRiskAction === 'allow_with_warning'
          ? `${this.getWarningMessage()}\n\n`
          : '';
      if (warningPrefix) {
        onToken(warningPrefix);
      }
      const result = await this.withTimeout(
        (signal) => this.llm.streamChatCompletion(prepared.prompt, onToken, { signal }),
        llmTimeoutMs,
        `LLM timed out after ${llmTimeoutMs}ms`,
      );
      const answer = `${warningPrefix}${result.content}`;
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          answer,
          Date.now() - generateStartedAt,
          this.contextBuilder.estimateTokens(prepared.prompt),
          this.contextBuilder.estimateTokens(answer),
          'success',
        ),
      );
      return {
        sources: prepared.sources,
        finalStatus: 'success' as const,
        requestId: prepared.requestId,
      };
    } catch (error) {
      const err = this.normalizeError(error);
      this.logger.error('LLM stream failed', err);
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          '',
          Date.now() - generateStartedAt,
          this.contextBuilder.estimateTokens(prepared.prompt),
          0,
          'error',
        ),
      );
      const streamError = new Error(err.message) as Error & {
        status?: number;
        detail?: unknown;
      };
      streamError.status = err.status;
      streamError.detail = err.detail;
      throw streamError;
    }
  }

  async getTrace(requestId: string) {
    return this.traceService.getByRequestId(requestId);
  }

  async recordFeedback(requestId: string, score: 1 | -1) {
    return this.traceService.recordFeedback(requestId, score);
  }
}
