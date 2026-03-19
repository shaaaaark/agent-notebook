import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { Document } from '@langchain/core/documents';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const rag = app.get(RagService);
    rag.clearKnowledgeBase();
    await rag.addDocuments([
      new Document({
        pageContent:
          'React 状态提升是把多个子组件共享的状态提升到最近公共父组件中统一管理。',
        metadata: { source: 'smoke-a.md', chunk_id: 'smoke-a-1' },
      }),
      new Document({
        pageContent:
          '如果两个输入框需要共享同一个温度值，就应该把 state 放到父组件，再通过 props 传给子组件。',
        metadata: { source: 'smoke-b.md', chunk_id: 'smoke-b-1' },
      }),
      new Document({
        pageContent: 'Docker 是一种容器技术，用于应用打包和部署。',
        metadata: { source: 'smoke-c.md', chunk_id: 'smoke-c-1' },
      }),
    ]);

    const result = await rag.retrieveDetailed('什么是 React 状态提升？', 3);
    console.log(JSON.stringify({
      strategy: result.strategy,
      degraded: result.degraded,
      degradeReason: result.degradeReason,
      chunks: result.chunks.map((item) => ({
        chunk_id: item.doc.metadata.chunk_id,
        source: item.doc.metadata.source,
        score: item.score,
        score_bm25: item.scoreBm25,
        score_rrf: item.scoreRrf,
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
