# Agent Notebook (NestJS)

MVP: upload md/txt/pdf → store in memory → RAG ask endpoint → scheduled review job.

## Setup
```bash
cp .env.example .env
# fill OPENAI_BASE_URL / OPENAI_API_KEY
```

## Run
```bash
npm run start:dev
```

## API
- POST /ingest/file (multipart/form-data, field: file)
- POST /rag/ask {"question":"..."}

## Notes
- Vector store is in-memory for MVP; next step is PostgreSQL + pgvector.
- Review job runs daily at 20:00 (Asia/Shanghai).
