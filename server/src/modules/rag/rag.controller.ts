import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';
import type { Response } from 'express';

@Controller('rag')
export class RagController {
  constructor(
    private readonly rag: RagService,
    private readonly config: ConfigService,
  ) {}

  @Post('ask')
  async ask(@Body() body: { question: string }, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: string, data?: string) => {
      if (event) res.write(`event: ${event}\n`);
      if (data !== undefined) res.write(`data: ${data}\n`);
      res.write('\n');
    };

    try {
      const result = await this.rag.askStream(body.question, (chunk) => {
        send('message', chunk);
      });
      send(
        'done',
        JSON.stringify({
          sources: result.sources,
          final_status: result.finalStatus,
          request_id: result.requestId,
        }),
      );
    } catch (err) {
      const error = err as Error & { status?: number; detail?: string };
      send('error', JSON.stringify({ message: error.message, status: error.status, detail: error.detail }));
    } finally {
      res.end();
    }
  }

  @Get('retrieve')
  async retrieve(@Query('q') q: string, @Query('k') k?: string) {
    if (!q?.trim()) {
      throw new BadRequestException('query param "q" is required');
    }
    const topK = k ? parseInt(k, 10) : undefined;
    if (topK !== undefined && (Number.isNaN(topK) || topK < 1)) {
      throw new BadRequestException('"k" must be a positive integer');
    }
    const result = await this.rag.retrieveDetailed(q, topK);
    return {
      query: q,
      topK: result.chunks.length,
      strategy: result.strategy,
      degraded: result.degraded,
      ...(result.degradeReason ? { degrade_reason: result.degradeReason } : {}),
      ...(result.rerankProvider ? { rerank_provider: result.rerankProvider } : {}),
      ...(result.rerankSkipped !== undefined
        ? { rerank_skipped: result.rerankSkipped }
        : {}),
      ...(result.rerankReason ? { rerank_reason: result.rerankReason } : {}),
      chunks: result.chunks.map((item) => ({
        chunk_id: String(item.doc.metadata.chunk_id ?? 'unknown'),
        source: String(item.doc.metadata.source ?? item.doc.metadata.filename ?? 'unknown'),
        score: Number(item.score.toFixed(4)),
        ...(item.scoreVec !== undefined
          ? { score_vec: Number(item.scoreVec.toFixed(4)) }
          : {}),
        ...(item.scoreBm25 !== undefined
          ? { score_bm25: Number(item.scoreBm25.toFixed(4)) }
          : {}),
        ...(item.scoreRrf !== undefined
          ? { score_rrf: Number(item.scoreRrf.toFixed(4)) }
          : {}),
        ...(item.rerankScore !== undefined
          ? { rerank_score: Number(item.rerankScore.toFixed(4)) }
          : {}),
        ...(item.rankVec !== undefined ? { rank_vec: item.rankVec } : {}),
        ...(item.rankBm25 !== undefined ? { rank_bm25: item.rankBm25 } : {}),
        ...(item.rankFinal !== undefined ? { rank_final: item.rankFinal } : {}),
        pageContent: item.doc.pageContent,
      })),
    };
  }

  @Get('debug')
  debug() {
    const baseUrl = this.config.get<string>('openai.baseUrl');
    const model = this.config.get<string>('openai.model');
    const embeddingBaseUrl = this.config.get<string>('openai.embeddingBaseUrl');
    const embeddingModel = this.config.get<string>('openai.embeddingModel');
    const apiKey = this.config.get<string>('openai.apiKey') ?? '';
    const embeddingApiKey = this.config.get<string>('openai.embeddingApiKey') ?? '';
    const envKey = process.env.OPENAI_API_KEY ?? '';
    const envEmbeddingKey = process.env.EMBEDDING_API_KEY ?? '';
    const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : apiKey;
    const maskedEmbeddingKey =
      embeddingApiKey.length > 8
        ? `${embeddingApiKey.slice(0, 4)}...${embeddingApiKey.slice(-4)}`
        : embeddingApiKey;
    const maskedEnvKey = envKey.length > 8 ? `${envKey.slice(0, 4)}...${envKey.slice(-4)}` : envKey;
    const maskedEnvEmbeddingKey =
      envEmbeddingKey.length > 8
        ? `${envEmbeddingKey.slice(0, 4)}...${envEmbeddingKey.slice(-4)}`
        : envEmbeddingKey;
    return {
      baseUrl,
      model,
      embeddingBaseUrl,
      embeddingModel,
      apiKey: maskedKey,
      embeddingApiKey: maskedEmbeddingKey,
      envKey: maskedEnvKey,
      envEmbeddingKey: maskedEnvEmbeddingKey,
    };
  }

  @Get('trace/:requestId')
  async getTrace(@Param('requestId') requestId: string) {
    const trace = await this.rag.getTrace(requestId);
    if (!trace) {
      throw new NotFoundException(`trace not found for request_id=${requestId}`);
    }
    return trace;
  }

  @Post('feedback')
  async feedback(@Body() body: { request_id?: string; score?: number }) {
    if (!body.request_id?.trim()) {
      throw new BadRequestException('request_id is required');
    }
    if (body.score !== 1 && body.score !== -1) {
      throw new BadRequestException('score must be 1 or -1');
    }

    const trace = await this.rag.recordFeedback(body.request_id, body.score);
    if (!trace) {
      throw new NotFoundException(`trace not found for request_id=${body.request_id}`);
    }

    return {
      ok: true,
      request_id: body.request_id,
      score: body.score,
    };
  }
}
