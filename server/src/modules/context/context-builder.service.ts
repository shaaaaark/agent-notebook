import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import type { RetrievedChunk } from '../retrieval/retrieval.types';

export type ContextSkipReason = 'source_limit' | 'low_marginal_gain' | 'token_budget';

export interface ContextBuilderInput {
  query: string;
  candidates: RetrievedChunk[];
  tokenBudget: number;
}

export interface SkippedChunk {
  chunk: RetrievedChunk;
  reason: ContextSkipReason;
}

export interface ContextBuilderOutput {
  selected: RetrievedChunk[];
  skipped: SkippedChunk[];
  contextText: string;
  stats: {
    selectedCount: number;
    tokenUsed: number;
    truncated: boolean;
  };
}

@Injectable()
export class ContextBuilderService {
  constructor(private readonly config: ConfigService) {}

  build(input: ContextBuilderInput): ContextBuilderOutput {
    const maxChunksPerSource =
      this.config.get<number>('context.maxChunksPerSource') ?? 2;
    const coverageMinGain =
      this.config.get<number>('context.coverageMinGain') ?? 0.05;

    const selected: RetrievedChunk[] = [];
    const skipped: SkippedChunk[] = [];
    const sourceCounts = new Map<string, number>();

    let tokenUsed = 0;
    let truncated = false;

    for (const candidate of input.candidates) {
      const source = String(
        candidate.doc.metadata.source ?? candidate.doc.metadata.filename ?? 'unknown',
      );
      const sourceCount = sourceCounts.get(source) ?? 0;

      if (sourceCount >= maxChunksPerSource) {
        skipped.push({ chunk: candidate, reason: 'source_limit' });
        continue;
      }

      const prevSelected = selected[selected.length - 1];
      if (
        prevSelected &&
        prevSelected.score - candidate.score < coverageMinGain
      ) {
        skipped.push({ chunk: candidate, reason: 'low_marginal_gain' });
        continue;
      }

      const evidenceIndex = selected.length + 1;
      const evidence = this.formatEvidence(candidate, evidenceIndex);
      const evidenceTokens = this.estimateTokens(evidence);
      const remainingBudget = input.tokenBudget - tokenUsed;

      if (remainingBudget <= 0) {
        skipped.push({ chunk: candidate, reason: 'token_budget' });
        truncated = true;
        break;
      }

      if (evidenceTokens > remainingBudget) {
        const trimmed = this.trimChunkToBudget(candidate, remainingBudget);
        if (!trimmed) {
          skipped.push({ chunk: candidate, reason: 'token_budget' });
          truncated = true;
          break;
        }

        selected.push(trimmed);
        sourceCounts.set(source, sourceCount + 1);
        tokenUsed = input.tokenBudget;
        truncated = true;
        break;
      }

      selected.push(candidate);
      sourceCounts.set(source, sourceCount + 1);
      tokenUsed += evidenceTokens;
    }

    return {
      selected,
      skipped,
      contextText: this.buildContextText(selected),
      stats: {
        selectedCount: selected.length,
        tokenUsed,
        truncated,
      },
    };
  }

  estimateTokens(text: string): number {
    const cjkChars = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
    const latinChars = text.replace(/[\u3400-\u9fff\s]/g, '').length;
    return cjkChars + Math.ceil(latinChars / 4);
  }

  private buildContextText(chunks: RetrievedChunk[]): string {
    return chunks.map((chunk, index) => this.formatEvidence(chunk, index + 1)).join('\n\n---\n\n');
  }

  private formatEvidence(chunk: RetrievedChunk, index: number): string {
    return `[E${index}] 来源：${String(
      chunk.doc.metadata.source ?? chunk.doc.metadata.filename ?? 'unknown',
    )}\n${chunk.doc.pageContent}`;
  }

  private trimChunkToBudget(
    chunk: RetrievedChunk,
    tokenBudget: number,
  ): RetrievedChunk | null {
    const source = String(
      chunk.doc.metadata.source ?? chunk.doc.metadata.filename ?? 'unknown',
    );
    const header = `[E1] 来源：${source}\n`;
    const headerTokens = this.estimateTokens(header);

    if (tokenBudget <= headerTokens + 4) {
      return null;
    }

    const allowedTokens = tokenBudget - headerTokens;
    const trimmedContent = this.fitTextToTokenBudget(chunk.doc.pageContent, allowedTokens);
    if (!trimmedContent.trim()) {
      return null;
    }

    return {
      ...chunk,
      doc: new Document({
        pageContent: trimmedContent,
        metadata: {
          ...chunk.doc.metadata,
          truncated: true,
        },
      }),
    };
  }

  private fitTextToTokenBudget(text: string, tokenBudget: number): string {
    let low = 0;
    let high = text.length;
    let best = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = text.slice(0, mid);
      if (this.estimateTokens(slice) <= tokenBudget) {
        best = slice;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best.trimEnd();
  }
}
