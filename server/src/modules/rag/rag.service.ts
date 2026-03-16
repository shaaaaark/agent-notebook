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
import { RequestTrace, TraceChunkRecord, TraceService } from '../trace/trace.service';

type VectorEntry = {
  doc: Document;
  vec: number[];
  vecType: 'openai' | 'local';
};

export type RetrievedChunk = {
  doc: Document;
  score: number;
};

export type RagSource = {
  chunk_id: string;
  source: string;
  score: number;
  snippet: string;
};

export type RagFinalStatus = 'success' | 'clarify' | 'abstain' | 'error';

type PreparedResponse = {
  requestId: string;
  retrieved: RetrievedChunk[];
  context: ContextBuilderOutput;
  retrieveLatencyMs: number;
  finalStatus: RagFinalStatus;
  prompt: string;
  answer?: string;
  sources: RagSource[];
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
  private readonly store: VectorEntry[] = [];
  private readonly localVecDim = 256;

  constructor(
    private readonly llm: LlmProvider,
    private readonly config: ConfigService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly traceService: TraceService,
  ) {}

  private textToLocalVector(text: string): number[] {
    const vec = new Array<number>(this.localVecDim).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
      }
      vec[hash % this.localVecDim] += 1;
    }
    return vec;
  }

  async addDocuments(docs: Document[]) {
    if (!docs.length) return;

    const texts = docs.map((doc) => doc.pageContent);
    let vectors: number[][];
    let vecType: 'openai' | 'local' = 'openai';
    try {
      vectors = await this.llm.embeddings.embedDocuments(texts);
    } catch (error) {
      this.logger.warn(
        `Embeddings unavailable, fallback to local vectorization: ${(error as Error).message}`,
      );
      vectors = texts.map((text) => this.textToLocalVector(text));
      vecType = 'local';
    }
    this.store.push(
      ...docs.map((doc, index) => ({
        doc,
        vec: vectors[index],
        vecType,
      })),
    );
    this.logger.log(`Added ${docs.length} docs with embeddings (memory store)`);
  }

  deleteBySource(source: string): number {
    const before = this.store.length;
    const remaining = this.store.filter((entry) => entry.doc.metadata.source !== source);
    this.store.length = 0;
    this.store.push(...remaining);
    return before - this.store.length;
  }

  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || !a.length) return 0;
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      aNorm += a[i] * a[i];
      bNorm += b[i] * b[i];
    }
    const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
    return denom === 0 ? 0 : dot / denom;
  }

  private buildPrompt(question: string, contextText: string) {
    return `你是知识库助手。请严格基于以下证据回答，每个论点须标注证据编号如 [E1]。
若证据不足，回复"根据现有资料无法回答，建议补充相关文档"，不得编造内容。

${contextText}

问题：${question}`;
  }

  private toSources(docs: RetrievedChunk[]): RagSource[] {
    return docs.map((item) => ({
      chunk_id: String(item.doc.metadata.chunk_id ?? 'unknown'),
      source: String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
      score: Number(item.score.toFixed(4)),
      snippet: item.doc.pageContent.slice(0, 80),
    }));
  }

  private toTraceChunks(docs: RetrievedChunk[]): TraceChunkRecord[] {
    return docs.map((item) => ({
      chunk_id: String(item.doc.metadata.chunk_id ?? 'unknown'),
      source: String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
      score: Number(item.score.toFixed(4)),
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

  private isSensitiveQuery(question: string): boolean {
    return /(医疗|诊断|法律|法务|投资|金融|财务|medical|legal|finance)/i.test(question);
  }

  private getClarifyMessage(question: string): string {
    return `当前知识库中未找到与「${question}」相关的证据。
建议：① 上传相关文档后重新提问；② 换一种表述方式。`;
  }

  private getAbstainMessage(question: string): string {
    return `当前知识库中关于「${question}」的证据不足，且该问题可能涉及高风险判断。
基于现有资料我不能直接下结论，建议补充更权威的文档后再提问。`;
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
    const tokenBudget = this.config.get<number>('context.tokenBudget') ?? 2000;
    const abstainThreshold = this.config.get<number>('rag.abstainThreshold') ?? 0.35;

    let retrieved: RetrievedChunk[] = [];
    let retrieveTimedOut = false;
    const retrieveStartedAt = Date.now();

    try {
      retrieved = await this.withTimeout(
        () => this.retrieve(question, topK),
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
      candidates: retrieved,
      tokenBudget,
    });
    const lowConfidence =
      retrieveTimedOut ||
      !retrieved.length ||
      retrieved.every((item) => item.score < abstainThreshold) ||
      context.selected.length === 0;

    if (lowConfidence) {
      const finalStatus: RagFinalStatus = this.isSensitiveQuery(question)
        ? 'abstain'
        : 'clarify';
      const answer =
        finalStatus === 'abstain'
          ? this.getAbstainMessage(question)
          : this.getClarifyMessage(question);

      return {
        requestId,
        retrieved,
        context,
        retrieveLatencyMs,
        finalStatus,
        prompt: '',
        answer,
        sources: this.toSources(context.selected),
      };
    }

    return {
      requestId,
      retrieved,
      context,
      retrieveLatencyMs,
      finalStatus: 'success',
      prompt: this.buildPrompt(question, context.contextText),
      sources: this.toSources(context.selected),
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
      query_raw: question,
      retrieve_topK: this.config.get<number>('retrieve.topK') ?? 8,
      retrieved_chunks: this.toTraceChunks(prepared.retrieved),
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
    if (!this.store.length) return [];

    let qVec: number[];
    let qVecType: 'openai' | 'local' = 'openai';
    try {
      qVec = await this.llm.embeddings.embedQuery(question);
    } catch (error) {
      this.logger.warn(
        `Query embedding unavailable, fallback to local vectorization: ${(error as Error).message}`,
      );
      qVec = this.textToLocalVector(question);
      qVecType = 'local';
    }
    const k = topK ?? (this.config.get<number>('retrieve.topK') ?? 8);
    return this.store
      .map((item) => ({
        doc: item.doc,
        score: item.vecType === qVecType ? this.cosine(qVec, item.vec) : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
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
      const answer = result.content;
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          answer,
          Date.now() - generateStartedAt,
          result.promptTokens || this.contextBuilder.estimateTokens(prepared.prompt),
          result.completionTokens || this.contextBuilder.estimateTokens(answer),
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
      const result = await this.withTimeout(
        (signal) => this.llm.streamChatCompletion(prepared.prompt, onToken, { signal }),
        llmTimeoutMs,
        `LLM timed out after ${llmTimeoutMs}ms`,
      );
      await this.traceService.write(
        this.buildTrace(
          question,
          prepared,
          result.content,
          Date.now() - generateStartedAt,
          this.contextBuilder.estimateTokens(prepared.prompt),
          this.contextBuilder.estimateTokens(result.content),
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
