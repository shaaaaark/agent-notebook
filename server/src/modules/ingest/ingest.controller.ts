import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { IngestService } from './ingest.service';
import * as path from 'path';

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
          cb(null, `${uniq}-${file.originalname}`);
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
}
