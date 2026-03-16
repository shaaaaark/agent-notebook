import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import { RagService } from '../rag/rag.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly fileHashes = new Map<string, string>();

  constructor(
    private readonly rag: RagService,
    private readonly config: ConfigService,
  ) {}

  private chunk(text: string, source: string): Document[] {
    const size = this.config.get<number>('chunk.size') ?? 500;
    const rawStep = this.config.get<number>('chunk.step') ?? 200;
    const step = Math.min(rawStep, size);
    if (rawStep > size) {
      this.logger.warn(`CHUNK_STEP(${rawStep}) > CHUNK_SIZE(${size}), clamped to ${size}`);
    }
    const chunks: Document[] = [];

    for (let offset = 0; offset < text.length; offset += step) {
      const pageContent = text.slice(offset, offset + size);
      if (!pageContent.trim()) {
        continue;
      }
      chunks.push(
        new Document({
          pageContent,
          metadata: {
            source,
            filename: source,
            chunk_id: `${source}#${offset}`,
            chunk_index: Math.floor(offset / step),
          },
        }),
      );
      if (offset + size >= text.length) {
        break;
      }
    }

    const totalChunks = chunks.length;
    return chunks.map(
      (doc) =>
        new Document({
          pageContent: doc.pageContent,
          metadata: { ...doc.metadata, total_chunks: totalChunks },
        }),
    );
  }

  async ingestFile(filePath: string, originalName: string) {
    const ext = path.extname(originalName).toLowerCase();
    const raw = await fs.readFile(filePath);
    let text = '';

    if (ext === '.txt' || ext === '.md') {
      text = raw.toString('utf-8');
    } else if (ext === '.pdf') {
      const parser = new PDFParse({ data: raw });
      const parsed = await parser.getText();
      text = parsed.text ?? '';
      await parser.destroy();
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const hash = crypto.createHash('sha256').update(text).digest('hex');
    if (this.fileHashes.get(originalName) === hash) {
      this.logger.log(`Skipped duplicate file ${originalName}`);
      return { ok: true, skipped: true, filename: originalName };
    }
    this.fileHashes.set(originalName, hash);

    const deleted = this.rag.deleteBySource(originalName);
    if (deleted > 0) {
      this.logger.log(`Cleared ${deleted} stale chunks for ${originalName}`);
    }

    const chunks = this.chunk(text, originalName);
    await this.rag.addDocuments(chunks);
    this.logger.log(`Ingested ${originalName} into ${chunks.length} chunks`);
    return { ok: true, skipped: false, filename: originalName, chunks: chunks.length };
  }
}
