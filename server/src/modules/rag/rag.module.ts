import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { LlmProvider } from '../../providers/llm.provider';

@Module({
  providers: [RagService, LlmProvider],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
