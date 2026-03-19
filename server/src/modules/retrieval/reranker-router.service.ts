import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BailianRerankerService } from './bailian-reranker.service';
import { LocalRerankerService } from './local-reranker.service';
import type { Reranker, RerankProvider, RerankResult } from './reranker.types';
import type { RetrievedChunk } from './retrieval.types';

@Injectable()
export class RerankerRouterService implements Reranker {
  private readonly logger = new Logger(RerankerRouterService.name);
  private warnedUnsupportedProvider = false;

  constructor(
    private readonly config: ConfigService,
    private readonly localReranker: LocalRerankerService,
    private readonly bailianReranker: BailianRerankerService,
  ) {}

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    limit: number,
  ): Promise<RerankResult> {
    const provider = this.getProvider();

    switch (provider) {
      case 'local':
        return this.localReranker.rerank(query, chunks, limit);
      case 'bailian':
        return this.bailianReranker.rerank(query, chunks, limit);
      default:
        if (!this.warnedUnsupportedProvider) {
          this.logger.warn(
            `Unsupported rerank provider "${provider}"; fallback to local reranker`,
          );
          this.warnedUnsupportedProvider = true;
        }
        return this.localReranker.rerank(query, chunks, limit);
    }
  }

  private getProvider(): RerankProvider | string {
    return this.config.get<string>('retrieve.rerankProvider') ?? 'local';
  }
}
