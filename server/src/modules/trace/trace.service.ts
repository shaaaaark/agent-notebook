import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export type TraceChunkRecord = {
  chunk_id: string;
  source: string;
  score: number;
  score_vec?: number;
  score_bm25?: number;
  score_rrf?: number;
  rerank_score?: number;
  rank_vec?: number;
  rank_bm25?: number;
  rank_final?: number;
};

export interface RequestTrace {
  request_id: string;
  timestamp: string;
  policy_version?: string;
  replay_input?: {
    query: string;
    selected_chunk_ids: string[];
    retrieved_chunk_ids: string[];
    model: string;
  };
  query_raw: string;
  retrieve_topK: number;
  retrieval_strategy?: string;
  retrieve_degraded?: boolean;
  retrieve_degrade_reason?: string;
  retrieved_chunks: TraceChunkRecord[];
  retrieve_latency_ms: number;
  selected_chunks: string[];
  selected_sources: string[];
  skipped_reasons: Record<string, number>;
  token_used: number;
  truncated: boolean;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  generate_latency_ms: number;
  answer_hash: string;
  citations_parsed: string[];
  final_status: string;
  user_feedback?: 1 | -1;
}

@Injectable()
export class TraceService {
  private readonly fileLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly config: ConfigService) {}

  createRequestId(): string {
    return crypto.randomUUID();
  }

  async write(trace: RequestTrace): Promise<void> {
    const filePath = this.getFilePathForTimestamp(trace.timestamp);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(trace)}\n`, 'utf-8');
  }

  async getByRequestId(requestId: string): Promise<RequestTrace | null> {
    const files = await this.listTraceFiles();

    for (const filePath of files) {
      const traces = await this.readTraceFile(filePath);
      const match = traces.find((trace) => trace.request_id === requestId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  async recordFeedback(
    requestId: string,
    score: 1 | -1,
  ): Promise<RequestTrace | null> {
    const files = await this.listTraceFiles();

    for (const filePath of files) {
      const traces = await this.readTraceFile(filePath);
      const index = traces.findIndex((trace) => trace.request_id === requestId);
      if (index === -1) {
        continue;
      }

      return this.withFileLock(filePath, async () => {
        const tracesReRead = await this.readTraceFile(filePath);
        const idx = tracesReRead.findIndex((t) => t.request_id === requestId);
        if (idx === -1) return null;

        tracesReRead[idx] = {
          ...tracesReRead[idx],
          user_feedback: score,
        };

        const content = tracesReRead.map((t) => JSON.stringify(t)).join('\n');
        await fs.writeFile(filePath, `${content}\n`, 'utf-8');
        return tracesReRead[idx];
      });
    }

    return null;
  }

  private async withFileLock<T>(
    filePath: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.fileLocks.get(filePath) ?? Promise.resolve();
    const next = prev
      .then(() => fn(), () => fn())
      .finally(() => {
        if (this.fileLocks.get(filePath) === next) {
          this.fileLocks.delete(filePath);
        }
      });
    this.fileLocks.set(filePath, next);
    return next;
  }

  private getTraceDir(): string {
    const configured = this.config.get<string>('trace.logDir')?.trim();
    const serverRoot = path.resolve(__dirname, '..', '..', '..');
    if (configured) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(serverRoot, configured);
    }
    return path.join(serverRoot, 'logs', 'traces');
  }

  private getFilePathForTimestamp(timestamp: string): string {
    const day = timestamp.slice(0, 10);
    return path.join(this.getTraceDir(), `${day}.jsonl`);
  }

  private async listTraceFiles(): Promise<string[]> {
    const dir = this.getTraceDir();
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((entry) => entry.endsWith('.jsonl'))
        .sort()
        .reverse()
        .map((entry) => path.join(dir, entry));
    } catch {
      return [];
    }
  }

  private async readTraceFile(filePath: string): Promise<RequestTrace[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RequestTrace);
  }
}
