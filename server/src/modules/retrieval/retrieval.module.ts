import { Module } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm.provider';
import { BailianRerankerService } from './bailian-reranker.service';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { LocalRerankerService } from './local-reranker.service';
import { RerankerRouterService } from './reranker-router.service';

@Module({
  providers: [
    HybridRetrieverService,
    LocalRerankerService,
    BailianRerankerService,
    RerankerRouterService,
    LlmProvider,
  ],
  exports: [
    HybridRetrieverService,
    LocalRerankerService,
    BailianRerankerService,
    RerankerRouterService,
    LlmProvider,
  ],
})
export class RetrievalModule {}
