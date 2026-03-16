export const appConfig = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  vectorStore: process.env.VECTOR_STORE ?? 'memory',
  schedule: {
    timezone: process.env.SCHEDULE_TIMEZONE ?? 'Asia/Shanghai',
    reviewCron: process.env.REVIEW_CRON ?? '0 20 * * *',
  },
});
