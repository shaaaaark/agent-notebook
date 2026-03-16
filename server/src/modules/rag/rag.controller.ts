import { Body, Controller, Post, Get, Res } from '@nestjs/common';
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
      await this.rag.askStream(body.question, (chunk) => {
        send('message', chunk);
      });
      send('done', '');
    } catch (err) {
      const error = err as Error & { status?: number; detail?: string };
      send('error', JSON.stringify({ message: error.message, status: error.status, detail: error.detail }));
    } finally {
      res.end();
    }
  }

  @Get('debug')
  debug() {
    const baseUrl = this.config.get<string>('openai.baseUrl');
    const model = this.config.get<string>('openai.model');
    const embeddingModel = this.config.get<string>('openai.embeddingModel');
    const apiKey = this.config.get<string>('openai.apiKey') ?? '';
    const envKey = process.env.OPENAI_API_KEY ?? '';
    const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : apiKey;
    const maskedEnvKey = envKey.length > 8 ? `${envKey.slice(0, 4)}...${envKey.slice(-4)}` : envKey;
    return {
      baseUrl,
      model,
      embeddingModel,
      apiKey: maskedKey,
      envKey: maskedEnvKey,
    };
  }
}

