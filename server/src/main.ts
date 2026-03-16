import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
  });
  await app.listen(process.env.PORT ?? 8788);
}
bootstrap();
