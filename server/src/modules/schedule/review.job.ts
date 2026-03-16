import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RagService } from '../rag/rag.service';

@Injectable()
export class ReviewJob {
  private readonly logger = new Logger(ReviewJob.name);

  constructor(private readonly rag: RagService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8PM, { timeZone: 'Asia/Shanghai' })
  async handleCron() {
    this.logger.log('Running daily review job...');
    // Placeholder: in real system, summarize recent docs and push reminders
    await this.rag.ask('Summarize recent notes for review.');
  }
}
