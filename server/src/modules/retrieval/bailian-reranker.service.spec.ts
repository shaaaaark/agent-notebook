import { Document } from '@langchain/core/documents';
import type { ConfigService } from '@nestjs/config';
import { BailianRerankerService } from './bailian-reranker.service';

describe('BailianRerankerService', () => {
  function makeChunk(id: string, content: string) {
    return {
      doc: new Document({
        pageContent: content,
        metadata: { chunk_id: id, source: 'spec' },
      }),
      score: 1,
    };
  }

  function createService(values: Record<string, unknown>) {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    return new BailianRerankerService(config);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips when config is missing', async () => {
    const service = createService({
      'guardrails.rerankTimeoutMs': 100,
    });

    const result = await service.rerank('q', [makeChunk('a', 'alpha')], 1);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('bailian_config_missing');
    expect(result.provider).toBe('bailian');
  });

  it('calls Bailian native rerank endpoint and maps ordered chunks', async () => {
    const service = createService({
      'bailian.rerankBaseUrl': 'https://dashscope.aliyuncs.com',
      'bailian.rerankApiKey': 'test-key',
      'bailian.rerankModel': 'qwen3-vl-rerank',
      'guardrails.rerankTimeoutMs': 100,
    });

    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        output: {
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.2 },
          ],
        },
      }),
    } as never);

    const result = await service.rerank(
      'q',
      [makeChunk('a', 'alpha'), makeChunk('b', 'beta')],
      2,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      model: 'qwen3-vl-rerank',
      input: {
        query: { text: 'q' },
        documents: [{ text: 'alpha' }, { text: 'beta' }],
      },
      parameters: {
        top_n: 2,
        return_documents: true,
      },
    });

    expect(result.skipped).toBe(false);
    expect(result.provider).toBe('bailian');
    expect(result.chunks.map((chunk) => chunk.doc.metadata.chunk_id)).toEqual(['b', 'a']);
    expect(result.chunks[0].rerankScore).toBe(0.9);
  });
});
