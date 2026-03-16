import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReviewJob } from './review.job';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [ScheduleModule.forRoot(), RagModule],
  providers: [ReviewJob],
})
export class AppScheduleModule {}
