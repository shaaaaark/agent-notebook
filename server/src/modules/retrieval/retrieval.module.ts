import { Module } from '@nestjs/common';
import { LlmProvider } from '../../providers/llm.provider';
import { HybridRetrieverService } from './hybrid-retriever.service';
import { LocalRerankerService } from './local-reranker.service';

@Module({
  providers: [HybridRetrieverService, LocalRerankerService, LlmProvider],
  exports: [HybridRetrieverService, LocalRerankerService, LlmProvider],
})
export class RetrievalModule {}
