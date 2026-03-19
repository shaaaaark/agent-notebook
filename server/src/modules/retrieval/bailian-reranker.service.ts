import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RerankResult, Reranker } from './reranker.types';
import type { RetrievedChunk } from './retrieval.types';

type BailianRerankResponse = {
  results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  output?: {
    results?: Array<{
      index?: number;
      relevance_score?: number;
      score?: number;
      document?: { text?: string };
    }>;
  };
};

@Injectable()
export class BailianRerankerService implements Reranker {
  private readonly logger = new Logger(BailianRerankerService.name);
  private warnedMissingConfig = false;

  constructor(private readonly config: ConfigService) {}

  async rerank(
    query: string,
    chunks: RetrievedChunk[],
    limit: number,
  ): Promise<RerankResult> {
    const startedAt = Date.now();
    const target = chunks.slice(0, Math.max(0, limit));

    if (!target.length) {
      return { chunks: [], skipped: false, latencyMs: 0, provider: 'bailian' };
    }

    const baseUrl = (this.config.get<string>('bailian.rerankBaseUrl') ?? '').replace(/\/$/, '');
    const apiKey = this.config.get<string>('bailian.rerankApiKey') ?? '';
    const model = this.config.get<string>('bailian.rerankModel') ?? 'qwen3-vl-rerank';
    const timeoutMs = this.config.get<number>('guardrails.rerankTimeoutMs') ?? 500;

    if (!baseUrl || !apiKey) {
      if (!this.warnedMissingConfig) {
        this.logger.warn('Bailian reranker config missing; fallback to degraded rerank path');
        this.warnedMissingConfig = true;
      }
      return this.skip(target, startedAt, 'bailian_config_missing');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/api/v1/services/rerank/text-rerank/text-rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'curl/8.5.0',
        },
        body: JSON.stringify({
          model,
          input: {
            query: { text: query },
            documents: target.map((chunk) => ({ text: chunk.doc.pageContent })),
          },
          parameters: {
            top_n: target.length,
            return_documents: true,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        return this.skip(target, startedAt, `bailian_http_${res.status}`);
      }

      const json = (await res.json()) as BailianRerankResponse;
      const results = json.output?.results ?? json.results ?? [];
      if (!Array.isArray(results) || !results.length) {
        return this.skip(target, startedAt, 'bailian_invalid_response');
      }

      const scored: RetrievedChunk[] = [];
      for (let rank = 0; rank < results.length; rank += 1) {
        const item = results[rank];
        const index = typeof item?.index === 'number' ? item.index : rank;
        const score =
          typeof item?.relevance_score === 'number'
            ? item.relevance_score
            : typeof item?.score === 'number'
              ? item.score
              : Number.NaN;
        const chunk = target[index];
        if (!chunk || !Number.isFinite(score)) {
          continue;
        }
        scored.push({
          ...chunk,
          rerankScore: score,
          rankFinal: rank + 1,
        });
      }

      if (!scored.length) {
        return this.skip(target, startedAt, 'bailian_score_mismatch');
      }

      return {
        chunks: scored,
        skipped: false,
        latencyMs: Date.now() - startedAt,
        provider: 'bailian',
      };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? 'bailian_timeout'
          : 'bailian_request_failed';
      return this.skip(target, startedAt, reason);
    } finally {
      clearTimeout(timeout);
    }
  }

  private skip(
    target: RetrievedChunk[],
    startedAt: number,
    reason: string,
  ): RerankResult {
    return {
      chunks: target.map((item, index) => ({
        ...item,
        rankFinal: index + 1,
      })),
      skipped: true,
      reason,
      latencyMs: Date.now() - startedAt,
      provider: 'bailian',
    };
  }
}
