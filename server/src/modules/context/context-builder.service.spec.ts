import { Document } from '@langchain/core/documents';
import type { ConfigService } from '@nestjs/config';
import { ContextBuilderService } from './context-builder.service';
import type { RetrievedChunk } from '../retrieval/retrieval.types';

function makeChunk(
  id: string,
  source: string,
  score: number,
  content = `chunk-${id} content`,
): RetrievedChunk {
  return {
    doc: new Document({
      pageContent: content,
      metadata: {
        chunk_id: id,
        source,
      },
    }),
    score,
    rerankScore: score,
  };
}

describe('ContextBuilderService', () => {
  function createService(values: Record<string, number>) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    return new ContextBuilderService(config);
  }

  it('respects minSelectedChunks before low relevance filtering', () => {
    const service = createService({
      'context.maxChunksPerSource': 5,
      'context.minIncrementalCoverage': 0.7,
      'context.minSelectedChunks': 3,
    });

    const result = service.build({
      query: 'test',
      candidates: [
        makeChunk('c1', 'a.md', 0.9),
        makeChunk('c2', 'b.md', 0.6),
        makeChunk('c3', 'c.md', 0.55),
        makeChunk('c4', 'd.md', 0.4),
      ],
      tokenBudget: 500,
    });

    expect(result.selected.map((item) => item.doc.metadata.chunk_id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        reason: 'low_relevance',
      }),
    ]);
  });

  it('can tighten low relevance filtering via final config key', () => {
    const service = createService({
      'context.maxChunksPerSource': 5,
      'context.minIncrementalCoverage': 0.7,
      'context.minSelectedChunks': 1,
    });

    const result = service.build({
      query: 'test',
      candidates: [makeChunk('c1', 'a.md', 0.9), makeChunk('c2', 'b.md', 0.4)],
      tokenBudget: 500,
    });

    expect(result.selected.map((item) => item.doc.metadata.chunk_id)).toEqual(['c1']);
    expect(result.skipped[0]?.reason).toBe('low_relevance');
  });

  it('uses token budget to stop context expansion', () => {
    const service = createService({
      'context.maxChunksPerSource': 5,
      'context.minIncrementalCoverage': 0.05,
      'context.minSelectedChunks': 3,
    });
    const first = makeChunk('c1', 'a.md', 0.9, 'first chunk');
    const second = makeChunk('c2', 'b.md', 0.8, 'second chunk');
    const tokenBudget = service.estimateTokens(`[E1] 来源：a.md\n${first.doc.pageContent}`);

    const result = service.build({
      query: 'test',
      candidates: [first, second],
      tokenBudget,
    });

    expect(result.selected.map((item) => item.doc.metadata.chunk_id)).toEqual(['c1']);
    expect(result.skipped[0]?.reason).toBe('token_budget');
    expect(result.stats.truncated).toBe(true);
    expect(result.stats.tokenUsed).toBe(tokenBudget);
  });
});
