import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './modules/config/config.module';
import { RagModule } from './modules/rag/rag.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { AppScheduleModule } from './modules/schedule/schedule.module';

@Module({
  imports: [AppConfigModule, RagModule, IngestModule, AppScheduleModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
