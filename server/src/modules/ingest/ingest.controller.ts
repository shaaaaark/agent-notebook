import {
  Controller,
  Get,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { IngestService } from './ingest.service';
import * as path from 'path';
import * as crypto from 'crypto';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('file')
  @UseInterceptors(
    FilesInterceptor('file', 20, {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const uniq = Date.now();
          const ext = path.extname(file.originalname).toLowerCase();
          const digest = crypto
            .createHash('sha1')
            .update(file.originalname)
            .digest('hex')
            .slice(0, 10);
          cb(null, `${uniq}-${digest}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.md', '.txt', '.pdf'].includes(ext)) {
          return cb(null, true);
        }
        return cb(new Error('Unsupported file type'), false);
      },
    }),
  )
  async ingestFile(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      return { ok: false, message: 'No files uploaded', uploaded: [] };
    }

    const uploaded = await Promise.all(
      files.map((file) => this.ingest.ingestFile(file.path, file.originalname)),
    );

    return {
      ok: true,
      count: uploaded.length,
      uploaded,
    };
  }

  @Get('status')
  getStatus() {
    return this.ingest.getStatus();
  }

  @Get('files')
  listFiles() {
    return this.ingest.listFiles();
  }

  @Post('reset')
  reset() {
    return this.ingest.reset();
  }

  @Post('reindex')
  async reindex() {
    return this.ingest.reindexAll();
  }
}
