import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { IngestService } from './ingest.service';
import * as path from 'path';
import * as crypto from 'crypto';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
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
  async ingestFile(@UploadedFile() file: Express.Multer.File) {
    return this.ingest.ingestFile(file.path, file.originalname);
  }

  @Get('status')
  getStatus() {
    return this.ingest.getStatus();
  }

  @Post('reindex')
  async reindex() {
    return this.ingest.reindexAll();
  }
}
