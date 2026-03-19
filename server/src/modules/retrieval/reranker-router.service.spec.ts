import type { ConfigService } from '@nestjs/config';
import { RerankerRouterService } from './reranker-router.service';

describe('RerankerRouterService', () => {
  function createService(provider?: string) {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'retrieve.rerankProvider') return provider;
        return undefined;
      }),
    } as unknown as ConfigService;
    const localReranker = {
      rerank: jest.fn(async () => ({
        chunks: [],
        skipped: false,
        latencyMs: 0,
        provider: 'local',
      })),
    };

    const bailianReranker = {
      rerank: jest.fn(async () => ({
        chunks: [],
        skipped: false,
        latencyMs: 0,
        provider: 'bailian',
      })),
    };

    return {
      service: new RerankerRouterService(config, localReranker as any, bailianReranker as any),
      localReranker,
      bailianReranker,
    };
  }

  it('uses local provider by default', async () => {
    const { service, localReranker } = createService();
    await service.rerank('q', [], 3);
    expect(localReranker.rerank).toHaveBeenCalledWith('q', [], 3);
  });

  it('routes to bailian provider when configured', async () => {
    const { service, bailianReranker, localReranker } = createService('bailian');
    await service.rerank('q', [], 3);
    expect(bailianReranker.rerank).toHaveBeenCalledWith('q', [], 3);
    expect(localReranker.rerank).not.toHaveBeenCalled();
  });
});
