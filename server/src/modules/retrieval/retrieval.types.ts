import { Document } from '@langchain/core/documents';
import type { RerankProvider } from './reranker.types';

export type RetrievalStrategy =
  | 'vector_only'
  | 'hybrid_rrf'
  | 'hybrid_rrf_rerank';

export type RetrievedChunk = {
  doc: Document;
  score: number;
  scoreVec?: number;
  scoreBm25?: number;
  scoreRrf?: number;
  rerankScore?: number;
  rankVec?: number;
  rankBm25?: number;
  rankFinal?: number;
};

export type RetrievalResult = {
  chunks: RetrievedChunk[];
  strategy: RetrievalStrategy;
  degraded: boolean;
  degradeReason?: string;
  rerankProvider?: RerankProvider;
  rerankSkipped?: boolean;
  rerankReason?: string;
};

export type KnowledgeBaseStatus = {
  documentCount: number;
  chunkCount: number;
  lastUpdatedAt: string | null;
  kbVersion: string;
};
