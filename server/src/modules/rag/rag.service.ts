import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm.provider';
import { Document } from '@langchain/core/documents';

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

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly store: VectorEntry[] = [];
  private readonly localVecDim = 256;

  constructor(
    private readonly llm: LlmProvider,
    private readonly config: ConfigService,
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

  private buildPrompt(question: string, docs: RetrievedChunk[]) {
    const evidence = docs
      .map(
        (item, i) =>
          `[E${i + 1}] 来源：${item.doc.metadata.source}\n${item.doc.pageContent}`,
      )
      .join('\n\n---\n\n');

    return `你是知识库助手。请严格基于以下证据回答，每个论点须标注证据编号如 [E1]。
若证据不足，回复"根据现有资料无法回答，建议补充相关文档"，不得编造内容。

${evidence}

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
    const docs = await this.retrieve(question);
    const prompt = this.buildPrompt(question, docs);
    try {
      const result = await this.llm.chat.invoke(prompt);
      return { answer: result.content, sources: this.toSources(docs) };
    } catch (error) {
      const err = error as Error & {
        status?: number;
        response?: { status?: number; statusText?: string; data?: unknown };
      };
      this.logger.error('LLM request failed', err);
      return {
        error: {
          message: err.message,
          status: err.status ?? err.response?.status,
          detail: err.response?.data ?? null,
        },
      };
    }
  }

  async askStream(question: string, onToken: (chunk: string) => void) {
    const docs = await this.retrieve(question);
    const prompt = this.buildPrompt(question, docs);
    await this.llm.streamChatCompletion(prompt, onToken);
    return { sources: this.toSources(docs) };
  }
}
