import type { RetrievedChunk } from './retrieval.types';

export type RerankProvider = 'local' | 'bailian';

export type RerankResult = {
  chunks: RetrievedChunk[];
  skipped: boolean;
  reason?: string;
  latencyMs: number;
  provider: RerankProvider;
};

export interface Reranker {
  rerank(
    query: string,
    chunks: RetrievedChunk[],
    limit: number,
  ): Promise<RerankResult>;
}
