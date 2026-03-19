import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RerankerRouterService } from '../src/modules/retrieval/reranker-router.service';
import { Document } from '@langchain/core/documents';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const reranker = app.get(RerankerRouterService);
    const chunks = [
      {
        doc: new Document({
          pageContent:
            'React 状态提升是把多个子组件共享的状态提升到最近公共父组件中统一管理。',
          metadata: { source: 'smoke-a.md', chunk_id: 'smoke-a-1' },
        }),
        score: 0.8,
        scoreRrf: 0.8,
      },
      {
        doc: new Document({
          pageContent: 'Docker 是一种容器技术，用于应用打包和部署。',
          metadata: { source: 'smoke-b.md', chunk_id: 'smoke-b-1' },
        }),
        score: 0.7,
        scoreRrf: 0.7,
      },
    ];

    const result = await reranker.rerank('什么是 React 状态提升？', chunks as any, 2);
    console.log(JSON.stringify({
      provider: result.provider,
      skipped: result.skipped,
      reason: result.reason,
      latencyMs: result.latencyMs,
      chunks: result.chunks.map((item) => ({
        chunk_id: item.doc.metadata.chunk_id,
        source: item.doc.metadata.source,
        rerank_score: item.rerankScore,
        rank_final: item.rankFinal,
      })),
    }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
