import { Injectable, Logger } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { RagService } from '../rag/rag.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly rag: RagService) {}

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

    const doc = new Document({
      pageContent: text,
      metadata: { filename: originalName, source: 'upload' },
    });

    await this.rag.addDocuments([doc]);
    this.logger.log(`Ingested ${originalName}`);
    return { ok: true, filename: originalName };
  }
}
