import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import { randomUUID } from 'crypto';
import { LlmProvider } from '../../providers/llm.provider';
import { LocalRerankerService } from './local-reranker.service';
import type {
  KnowledgeBaseStatus,
  RetrievedChunk,
  RetrievalResult,
  RetrievalStrategy,
} from './retrieval.types';

const bm25Factory = require('wink-bm25-text-search');

type VectorEntry = {
  doc: Document;
  vec: number[];
  vecType: 'openai' | 'local';
};

type Bm25Engine = {
  defineConfig: (config: Record<string, unknown>) => void;
  definePrepTasks: (tasks: Array<(text: string) => string[]>) => void;
  addDoc: (doc: Record<string, unknown>, id: string) => void;
  consolidate: () => void;
  search: (query: string, limit?: number) => Array<[string, number]>;
};

type RetrieveOptions = {
  topK?: number;
};

@Injectable()
export class HybridRetrieverService implements OnModuleInit {
  private readonly logger = new Logger(HybridRetrieverService.name);
  private readonly localVecDim = 256;
  private readonly sourceDocs = new Map<string, Document[]>();
  private readonly entryByChunkId = new Map<string, VectorEntry>();

  private store: VectorEntry[] = [];
  private bm25: Bm25Engine | null = null;
  private kbVersion = this.createKbVersion();
  private lastUpdatedAt: string | null = null;

  constructor(
    private readonly llm: LlmProvider,
    private readonly config: ConfigService,
    private readonly reranker: LocalRerankerService,
  ) {}

  async onModuleInit() {
    try {
      await this.llm.embeddings.embedQuery('__agent_notebook_embedding_healthcheck__');
      this.logger.log('Embedding backend health check passed');
    } catch (error) {
      this.logger.warn(
        `Embedding backend health check failed, retrieval will fallback to local vectors: ${(error as Error).message}`,
      );
    }
  }

  async addDocuments(docs: Document[]) {
    if (!docs.length) return;

    const source = this.getSource(docs[0]);
    const texts = docs.map((doc) => doc.pageContent);
    const { vectors, vecType } = await this.embedTexts(texts);
    const entries = docs.map((doc, index) => ({
      doc,
      vec: vectors[index],
      vecType,
    }));

    this.sourceDocs.set(source, docs);
    this.store = this.store.filter((entry) => this.getSource(entry.doc) !== source);
    this.store.push(...entries);
    this.rebuildEntryMap();
    this.rebuildBm25Index();
    this.touchKnowledgeBase();
    this.logger.log(`Indexed ${docs.length} chunks for ${source}`);
  }

  deleteBySource(source: string): number {
    const before = this.store.length;
    this.sourceDocs.delete(source);
    this.store = this.store.filter((entry) => this.getSource(entry.doc) !== source);
    this.rebuildEntryMap();
    this.rebuildBm25Index();
    if (before !== this.store.length) {
      this.touchKnowledgeBase();
    }
    return before - this.store.length;
  }

  async rebuildIndex(docGroups?: Array<{ source: string; docs: Document[] }>) {
    const groups = docGroups ?? Array.from(this.sourceDocs.entries()).map(([source, docs]) => ({
      source,
      docs,
    }));

    this.sourceDocs.clear();
    this.store = [];
    this.entryByChunkId.clear();

    for (const group of groups) {
      if (!group.docs.length) continue;
      this.sourceDocs.set(group.source, group.docs);
      const texts = group.docs.map((doc) => doc.pageContent);
      const { vectors, vecType } = await this.embedTexts(texts);
      this.store.push(
        ...group.docs.map((doc, index) => ({
          doc,
          vec: vectors[index],
          vecType,
        })),
      );
    }

    this.rebuildEntryMap();
    this.rebuildBm25Index();
    this.kbVersion = this.createKbVersion();
    this.touchKnowledgeBase(false);
  }

  clear(): void {
    this.sourceDocs.clear();
    this.store = [];
    this.entryByChunkId.clear();
    this.bm25 = null;
    this.kbVersion = this.createKbVersion();
    this.touchKnowledgeBase(false);
  }

  async retrieve(question: string, options?: RetrieveOptions): Promise<RetrievalResult> {
    const topK = options?.topK ?? (this.config.get<number>('retrieve.topK') ?? 8);
    if (!this.store.length) {
      return {
        chunks: [],
        strategy: 'vector_only',
        degraded: true,
        degradeReason: 'empty_store',
      };
    }

    const normalizedQuery = this.normalizeQuery(question);
    const vectorHits = await this.retrieveVectorHits(normalizedQuery);
    const bm25Hits = this.retrieveBm25Hits(normalizedQuery);

    const topKVec = this.config.get<number>('retrieve.topKVec') ?? 50;
    const topKBm25 = this.config.get<number>('retrieve.topKBm25') ?? 50;
    const fusedTopN = this.config.get<number>('retrieve.fusedTopN') ?? 30;
    const rerankTopM = this.config.get<number>('retrieve.rerankTopM') ?? 8;

    const limitedVectorHits = vectorHits.slice(0, topKVec);
    const limitedBm25Hits = bm25Hits.slice(0, topKBm25);
    const hasLexicalSignal = limitedBm25Hits.some((item) => (item.scoreBm25 ?? 0) > 0);

    let fused = this.fuseRanks(
      limitedVectorHits,
      limitedBm25Hits,
      fusedTopN,
    );

    let strategy: RetrievalStrategy = hasLexicalSignal ? 'hybrid_rrf' : 'vector_only';
    let degraded = !hasLexicalSignal;
    let degradeReason = !hasLexicalSignal ? 'bm25_unavailable' : undefined;

    if (!hasLexicalSignal) {
      fused = limitedVectorHits
        .slice(0, fusedTopN)
        .map((item, index) => ({
          ...item,
          score: item.scoreVec ?? item.score,
          rankFinal: index + 1,
        }));
    }

    const rerankResult = await this.reranker.rerank(
      normalizedQuery,
      fused,
      Math.min(rerankTopM, fused.length),
    );
    if (!rerankResult.skipped && rerankResult.chunks.length) {
      strategy = hasLexicalSignal ? 'hybrid_rrf_rerank' : 'vector_only';
    }
    if (rerankResult.skipped) {
      strategy = hasLexicalSignal ? 'hybrid_rrf' : 'vector_only';
      degraded = true;
      degradeReason = rerankResult.reason ?? degradeReason ?? 'rerank_skipped';
    }

    const rerankedChunkIds = new Set(
      rerankResult.chunks.map((item) =>
        String(item.doc.metadata.chunk_id ?? 'unknown'),
      ),
    );
    const reranked = rerankResult.chunks;
    const remaining = fused
      .filter(
        (item) =>
          !rerankedChunkIds.has(String(item.doc.metadata.chunk_id ?? 'unknown')),
      )
      .map((item, index) => ({
        ...item,
        rankFinal: reranked.length + index + 1,
      }));
    const finalChunks = [...reranked, ...remaining]
      .slice(0, topK)
      .map((item, index) => ({
        ...item,
        rankFinal: index + 1,
        score:
          item.rerankScore ??
          item.scoreRrf ??
          item.scoreVec ??
          item.scoreBm25 ??
          item.score,
      }));

    return {
      chunks: finalChunks,
      strategy,
      degraded,
      ...(degradeReason ? { degradeReason } : {}),
    };
  }

  getStatus(): KnowledgeBaseStatus {
    return {
      documentCount: this.sourceDocs.size,
      chunkCount: this.store.length,
      lastUpdatedAt: this.lastUpdatedAt,
      kbVersion: this.kbVersion,
    };
  }

  private async retrieveVectorHits(query: string): Promise<RetrievedChunk[]> {
    let qVec: number[];
    let qVecType: 'openai' | 'local' = 'openai';
    try {
      qVec = await this.llm.embeddings.embedQuery(query);
    } catch (error) {
      this.logger.warn(
        `Query embedding unavailable, fallback to local vectorization: ${(error as Error).message}`,
      );
      qVec = this.textToLocalVector(query);
      qVecType = 'local';
    }

    return this.store
      .map((item) => {
        const similarity = item.vecType === qVecType ? this.cosine(qVec, item.vec) : 0;
        return {
          doc: item.doc,
          score: similarity,
          scoreVec: similarity,
        };
      })
      .sort((a, b) => (b.scoreVec ?? 0) - (a.scoreVec ?? 0))
      .map((item, index) => ({
        ...item,
        rankVec: index + 1,
      }));
  }

  private retrieveBm25Hits(query: string): RetrievedChunk[] {
    if (!this.bm25) {
      return this.retrieveLexicalFallback(query);
    }

    try {
      const hits = this.bm25.search(
        query,
        this.config.get<number>('retrieve.topKBm25') ?? 50,
      )
        .map(([chunkId, score], index) => {
          const entry = this.entryByChunkId.get(chunkId);
          if (!entry) return null;
          return {
            doc: entry.doc,
            score,
            scoreBm25: score,
            rankBm25: index + 1,
          };
        });
      return hits.filter((item) => item !== null);
    } catch (error) {
      this.logger.warn(`BM25 search unavailable, fallback to lexical search: ${(error as Error).message}`);
      return this.retrieveLexicalFallback(query);
    }
  }

  private retrieveLexicalFallback(query: string): RetrievedChunk[] {
    const queryTokens = this.prepareTokens(query);
    if (!queryTokens.length) return [];

    return this.store
      .map((entry) => {
        const docTokens = new Set(this.prepareTokens(entry.doc.pageContent));
        const overlap = queryTokens.reduce(
          (count, token) => count + (docTokens.has(token) ? 1 : 0),
          0,
        );
        return {
          doc: entry.doc,
          score: overlap,
          scoreBm25: overlap,
        };
      })
      .filter((item) => (item.scoreBm25 ?? 0) > 0)
      .sort((a, b) => (b.scoreBm25 ?? 0) - (a.scoreBm25 ?? 0))
      .map((item, index) => ({
        ...item,
        rankBm25: index + 1,
      }));
  }

  private fuseRanks(
    vectorHits: RetrievedChunk[],
    bm25Hits: RetrievedChunk[],
    limit: number,
  ): RetrievedChunk[] {
    const merged = new Map<string, RetrievedChunk>();
    const rrfK = this.config.get<number>('retrieve.rrfK') ?? 60;

    for (const hit of vectorHits) {
      const chunkId = String(hit.doc.metadata.chunk_id ?? 'unknown');
      const existing = merged.get(chunkId);
      const rrf = 1 / ((hit.rankVec ?? 0) + rrfK);
      merged.set(chunkId, {
        ...(existing ?? hit),
        doc: hit.doc,
        scoreVec: hit.scoreVec ?? existing?.scoreVec,
        rankVec: hit.rankVec ?? existing?.rankVec,
        scoreRrf: (existing?.scoreRrf ?? 0) + rrf,
      });
    }

    for (const hit of bm25Hits) {
      const chunkId = String(hit.doc.metadata.chunk_id ?? 'unknown');
      const existing = merged.get(chunkId);
      const rrf = 1 / ((hit.rankBm25 ?? 0) + rrfK);
      merged.set(chunkId, {
        ...(existing ?? hit),
        doc: hit.doc,
        scoreBm25: hit.scoreBm25 ?? existing?.scoreBm25,
        rankBm25: hit.rankBm25 ?? existing?.rankBm25,
        scoreVec: existing?.scoreVec,
        rankVec: existing?.rankVec,
        scoreRrf: (existing?.scoreRrf ?? 0) + rrf,
      });
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.scoreRrf ?? 0) - (a.scoreRrf ?? 0))
      .slice(0, limit)
      .map((item, index) => ({
        ...item,
        score: item.scoreRrf ?? item.scoreVec ?? item.scoreBm25 ?? 0,
        rankFinal: index + 1,
      }));
  }

  private async embedTexts(texts: string[]): Promise<{
    vectors: number[][];
    vecType: 'openai' | 'local';
  }> {
    try {
      const batchSize = 10;
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchVectors = await this.llm.embeddings.embedDocuments(batch);
        vectors.push(...batchVectors);
      }
      return {
        vectors,
        vecType: 'openai',
      };
    } catch (error) {
      this.logger.warn(
        `Embeddings unavailable, fallback to local vectorization: ${(error as Error).message}`,
      );
      return {
        vectors: texts.map((text) => this.textToLocalVector(text)),
        vecType: 'local',
      };
    }
  }

  private rebuildBm25Index() {
    if (!this.store.length) {
      this.bm25 = null;
      return;
    }

    if (this.store.length < 3) {
      this.bm25 = null;
      return;
    }

    const engine = bm25Factory() as Bm25Engine;
    engine.defineConfig({
      fldWeights: { text: 1 },
      ovFldNames: ['source', 'chunk_id'],
    });
    engine.definePrepTasks([this.prepareTokens.bind(this)]);

    for (const entry of this.store) {
      const chunkId = String(entry.doc.metadata.chunk_id ?? randomUUID());
      engine.addDoc(
        {
          text: entry.doc.pageContent,
          source: this.getSource(entry.doc),
          chunk_id: chunkId,
        },
        chunkId,
      );
    }

    engine.consolidate();
    this.bm25 = engine;
  }

  private rebuildEntryMap() {
    this.entryByChunkId.clear();
    for (const entry of this.store) {
      const chunkId = String(entry.doc.metadata.chunk_id ?? 'unknown');
      this.entryByChunkId.set(chunkId, entry);
    }
  }

  private touchKnowledgeBase(rotateVersion = false) {
    if (rotateVersion) {
      this.kbVersion = this.createKbVersion();
    }
    this.lastUpdatedAt = new Date().toISOString();
  }

  private createKbVersion(): string {
    return `kb_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  private normalizeQuery(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private prepareTokens(input: string | string[] | Record<string, unknown>): string[] {
    const text = this.extractTextForTokenize(input);
    const normalized = text.toLowerCase();
    const coarse = normalized.match(/[a-z]+|\d+|[\u4e00-\u9fa5]+/g) ?? [];

    const expanded = coarse.flatMap((token) => {
      if (/^[\u4e00-\u9fa5]+$/.test(token) && token.length > 1) {
        const chars = token.split('');
        const bigrams: string[] = [];
        for (let i = 0; i < chars.length - 1; i++) {
          bigrams.push(`${chars[i]}${chars[i + 1]}`);
        }
        return [token, ...chars, ...bigrams];
      }
      return [token];
    });

    return Array.from(new Set(expanded));
  }

  private extractTextForTokenize(input: string | string[] | Record<string, unknown>): string {
    if (typeof input === 'string') {
      return input;
    }

    if (Array.isArray(input)) {
      return input.join(' ');
    }

    if (input && typeof input === 'object') {
      const text = input.text;
      if (typeof text === 'string') {
        return text;
      }
      if (Array.isArray(text)) {
        return text.join(' ');
      }
      return Object.values(input)
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    }

    return '';
  }

  private getSource(doc: Document): string {
    return String(doc.metadata.source ?? doc.metadata.filename ?? 'unknown');
  }

  private textToLocalVector(text: string): number[] {
    const vec = new Array<number>(this.localVecDim).fill(0);
    const tokens = this.prepareTokens(text);
    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
      }
      vec[hash % this.localVecDim] += 1;
    }
    return vec;
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
}
