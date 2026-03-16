import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { LlmProvider } from '../../providers/llm.provider';
import { ContextModule } from '../context/context.module';
import { TraceModule } from '../trace/trace.module';

@Module({
  imports: [ContextModule, TraceModule],
  providers: [RagService, LlmProvider],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
