import { Document } from '@langchain/core/documents';
import type { ConfigService } from '@nestjs/config';
import { HybridRetrieverService } from './hybrid-retriever.service';

function makeDoc(id: string, source: string, content: string): Document {
  return new Document({
    pageContent: content,
    metadata: {
      chunk_id: id,
      source,
    },
  });
}

describe('HybridRetrieverService', () => {
  function createService(
    values: Record<string, unknown>,
    rerankImpl?: (query: string, chunks: any[]) => Promise<any>,
  ) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const llm = {
      embeddings: {
        embedQuery: jest.fn(async () => [1, 0]),
      },
    };
    const reranker = {
      rerank: jest.fn(
        rerankImpl ??
          (async (_query: string, chunks: any[]) => ({
            chunks,
            skipped: false,
            latencyMs: 0,
            provider: 'local',
          })),
      ),
    };
    const service = new HybridRetrieverService(llm as any, config, reranker as any);
    const firstDoc = makeDoc('c1', 'a.md', 'alpha');
    const secondDoc = makeDoc('c2', 'b.md', 'beta');

    (service as any).store = [
      { doc: firstDoc, vec: [1, 0], vecType: 'openai' },
      { doc: secondDoc, vec: [0, 1], vecType: 'openai' },
    ];
    (service as any).entryByChunkId = new Map([
      ['c1', { doc: firstDoc, vec: [1, 0], vecType: 'openai' }],
      ['c2', { doc: secondDoc, vec: [0, 1], vecType: 'openai' }],
    ]);
    (service as any).bm25 = {
      search: jest.fn(() => [
        ['c1', 0.4],
        ['c2', 0.3],
      ]),
    };

    return { service, reranker };
  }

  it('falls back to vector-only when bm25 hits do not meet min_bm25_hits boundary', async () => {
    const { service } = createService({
      'retrieve.topK': 2,
      'retrieve.topKVec': 10,
      'retrieve.topKBm25': 10,
      'retrieve.fusedTopN': 10,
      'retrieve.rerankTopM': 2,
      'retrieve.rrfK': 60,
      'retrieve.lexicalSignal.minBm25Score': 0.4,
      'retrieve.lexicalSignal.minBm25Hits': 2,
      'retrieve.lexicalSignal.minRrfScore': 0,
    });

    const result = await service.retrieve('alpha');
    expect(result.strategy).toBe('vector_only');
    expect(result.degraded).toBe(true);
  });

  it('enables hybrid fusion when bm25 score and hits meet the boundary', async () => {
    const { service } = createService({
      'retrieve.topK': 2,
      'retrieve.topKVec': 10,
      'retrieve.topKBm25': 10,
      'retrieve.fusedTopN': 10,
      'retrieve.rerankTopM': 2,
      'retrieve.rrfK': 60,
      'retrieve.lexicalSignal.minBm25Score': 0.3,
      'retrieve.lexicalSignal.minBm25Hits': 2,
      'retrieve.lexicalSignal.minRrfScore': 0,
    });

    const result = await service.retrieve('alpha');
    expect(result.strategy).toBe('hybrid_rrf_rerank');
    expect(result.degraded).toBe(false);
    expect(result.chunks[0]?.scoreBm25).toBeDefined();
    expect(result.rerankProvider).toBe('local');
    expect(result.rerankSkipped).toBe(false);
  });

  it('filters fused results when min_rrf_score is higher than the fused boundary', async () => {
    const { service } = createService({
      'retrieve.topK': 2,
      'retrieve.topKVec': 10,
      'retrieve.topKBm25': 10,
      'retrieve.fusedTopN': 10,
      'retrieve.rerankTopM': 2,
      'retrieve.rrfK': 60,
      'retrieve.lexicalSignal.minBm25Score': 0.3,
      'retrieve.lexicalSignal.minBm25Hits': 1,
      'retrieve.lexicalSignal.minRrfScore': 1,
    });

    const result = await service.retrieve('alpha');
    expect(result.chunks).toHaveLength(0);
    expect(result.strategy).toBe('hybrid_rrf');
  });

  it('keeps reachable hybrid candidates under production-like rrf threshold', async () => {
    const { service } = createService({
      'retrieve.topK': 2,
      'retrieve.topKVec': 10,
      'retrieve.topKBm25': 10,
      'retrieve.fusedTopN': 10,
      'retrieve.rerankTopM': 2,
      'retrieve.rrfK': 60,
      'retrieve.lexicalSignal.minBm25Score': 0.3,
      'retrieve.lexicalSignal.minBm25Hits': 2,
      'retrieve.lexicalSignal.minRrfScore': 0.02,
    });

    const result = await service.retrieve('alpha');
    expect(result.strategy).toBe('hybrid_rrf_rerank');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.scoreRrf).toBeGreaterThanOrEqual(0.02);
  });

  it('applies bailian rerank order inside retrieval pipeline', async () => {
    const { service, reranker } = createService(
      {
        'retrieve.topK': 2,
        'retrieve.topKVec': 10,
        'retrieve.topKBm25': 10,
        'retrieve.fusedTopN': 10,
        'retrieve.rerankTopM': 2,
        'retrieve.rrfK': 60,
        'retrieve.lexicalSignal.minBm25Score': 0.3,
        'retrieve.lexicalSignal.minBm25Hits': 2,
        'retrieve.lexicalSignal.minRrfScore': 0,
        'retrieve.rerankProvider': 'bailian',
      },
      async (_query, chunks) => ({
        chunks: [
          { ...chunks[1], rerankScore: 0.9, rankFinal: 1 },
          { ...chunks[0], rerankScore: 0.2, rankFinal: 2 },
        ],
        skipped: false,
        latencyMs: 12,
        provider: 'bailian',
      }),
    );

    const result = await service.retrieve('alpha');
    expect(reranker.rerank).toHaveBeenCalled();
    expect(result.strategy).toBe('hybrid_rrf_rerank');
    expect(result.degraded).toBe(false);
    expect(result.rerankProvider).toBe('bailian');
    expect(result.rerankSkipped).toBe(false);
    expect(result.chunks.map((chunk) => chunk.doc.metadata.chunk_id)).toEqual(['c2', 'c1']);
    expect(result.chunks[0]?.rerankScore).toBe(0.9);
  });

  it('exposes rerank skipped reason for observability', async () => {
    const { service } = createService(
      {
        'retrieve.topK': 2,
        'retrieve.topKVec': 10,
        'retrieve.topKBm25': 10,
        'retrieve.fusedTopN': 10,
        'retrieve.rerankTopM': 2,
        'retrieve.rrfK': 60,
        'retrieve.lexicalSignal.minBm25Score': 0.3,
        'retrieve.lexicalSignal.minBm25Hits': 2,
        'retrieve.lexicalSignal.minRrfScore': 0,
      },
      async (query, chunks) => ({
        chunks,
        skipped: true,
        reason: 'rerank_timeout',
        latencyMs: 500,
        provider: 'bailian',
      }),
    );

    const result = await service.retrieve('alpha');
    expect(result.strategy).toBe('hybrid_rrf');
    expect(result.degraded).toBe(true);
    expect(result.degradeReason).toBe('rerank_timeout');
    expect(result.rerankProvider).toBe('bailian');
    expect(result.rerankSkipped).toBe(true);
    expect(result.rerankReason).toBe('rerank_timeout');
  });
});
