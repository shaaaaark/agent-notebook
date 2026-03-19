import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RerankResult, Reranker } from './reranker.types';
import type { RetrievedChunk } from './retrieval.types';

type TextClassifier = (
  input: string | string[],
  options?: Record<string, unknown>,
) => Promise<Array<{ label?: string; score?: number }> | { label?: string; score?: number }>;

@Injectable()
export class LocalRerankerService implements OnModuleInit, Reranker {
  private readonly logger = new Logger(LocalRerankerService.name);
  private classifierPromise: Promise<TextClassifier> | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    try {
      await this.withTimeout(
        () => this.getClassifier(),
        this.config.get<number>('guardrails.rerankTimeoutMs') ?? 5000,
        'rerank warmup timed out',
      );
      this.logger.log('Local reranker warmup complete');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Local reranker warmup skipped: ${reason}`);
    }
  }

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    limit: number,
  ): Promise<RerankResult> {
    if (!chunks.length) {
      return { chunks: [], skipped: false, latencyMs: 0, provider: 'local' };
    }

    const target = chunks.slice(0, Math.max(1, limit));
    const timeoutMs = this.config.get<number>('guardrails.rerankTimeoutMs') ?? 500;
    const startedAt = Date.now();

    try {
      const classifier = await this.withTimeout(
        () => this.getClassifier(),
        timeoutMs,
        `rerank model load timed out after ${timeoutMs}ms`,
      );
      const inputs = target.map(
        (item) =>
          `Query: ${query}\nDocument: ${item.doc.pageContent}\nRelevant:`,
      );
      const rawScores = await this.withTimeout(
        () => classifier(inputs, { topk: 1 }),
        timeoutMs,
        `rerank scoring timed out after ${timeoutMs}ms`,
      );
      const outputs = Array.isArray(rawScores) ? rawScores : [rawScores];

      const reranked = target
        .map((item, index) => ({
          ...item,
          rerankScore: this.normalizeScore(outputs[index]),
        }))
        .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
        .map((item, index) => ({
          ...item,
          score: item.rerankScore ?? item.score,
          rankFinal: index + 1,
        }));

      return {
        chunks: reranked,
        skipped: false,
        latencyMs: Date.now() - startedAt,
        provider: 'local',
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Local rerank skipped: ${reason}`);
      return {
        chunks: target.map((item, index) => ({
          ...item,
          rankFinal: index + 1,
        })),
        skipped: true,
        reason,
        latencyMs: Date.now() - startedAt,
        provider: 'local',
      };
    }
  }

  private async getClassifier(): Promise<TextClassifier> {
    if (!this.classifierPromise) {
      this.classifierPromise = this.loadClassifier();
    }
    return this.classifierPromise;
  }

  private async loadClassifier(): Promise<TextClassifier> {
    const model =
      this.config.get<string>('retrieve.rerankModel') ??
      'Xenova/bge-reranker-base';
    const { pipeline } = (await import('@xenova/transformers')) as {
      pipeline: (
        task: string,
        model: string,
        options?: Record<string, unknown>,
      ) => Promise<TextClassifier>;
    };
    return pipeline('text-classification', model, {
      quantized: true,
    });
  }

  private normalizeScore(result?: { label?: string; score?: number }): number {
    if (!result) return 0;
    const score = result.score ?? 0;
    const label = (result.label ?? '').toLowerCase();
    if (
      label.includes('label_0') ||
      label.includes('negative') ||
      label.includes('irrelevant')
    ) {
      return 1 - score;
    }
    return score;
  }

  private async withTimeout<T>(
    executor: () => Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        executor(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
