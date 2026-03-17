import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { ContextModule } from '../context/context.module';
import { TraceModule } from '../trace/trace.module';
import { RetrievalModule } from '../retrieval/retrieval.module';

@Module({
  imports: [ContextModule, TraceModule, RetrievalModule],
  providers: [RagService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
