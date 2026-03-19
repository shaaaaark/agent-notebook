# Repository Guidelines

## AI Working Mode

- The mainline mission in this repository is to complete the roadmap in `ROADMAP.md`.
- Operate as the system architect and technical lead, not as a free-roaming coder.
- Implement code changes directly in this repository by default. Break roadmap work into smaller concrete tasks and execute them in the current session instead of defaulting to Codex delegation.
- Do not describe the repository working mode as Codex-led or Codex-assisted unless the user explicitly re-enables that path.
- Unless explicitly verified in the current turn, assume there is no Codex task running for this repository.
- Your responsibility is to set priorities, define acceptance criteria, keep architectural coherence, review implementation quality, and prevent roadmap drift.
- Do not switch to unrelated cleanup, repo polishing, or side experiments unless they directly unblock the current roadmap node.
- Reorder roadmap tasks only when there is a clear dependency or unblock reason, and state that reason briefly.
- For each roadmap node, try to close the loop: scope, implementation, verification, and outcome.

## Project Structure & Module Organization
This repository is split into two apps:

- `server/`: NestJS backend for file ingest, RAG retrieval, tracing, and scheduled review jobs.
- `web/`: React + Vite frontend for upload and chat UI.

Backend source lives in `server/src/modules/` with feature folders such as `ingest/`, `rag/`, and `schedule/`. Shared providers are in `server/src/providers/`. Unit tests sit beside source as `*.spec.ts`; e2e tests live in `server/test/`. Evaluation cases are under `server/eval/cases/`. Frontend source is in `web/src/`, with static assets in `web/src/assets/` and `web/public/`.

## Build, Test, and Development Commands
Install dependencies per app:

```bash
cd server && npm install
cd web && npm install
```

Key commands:

- `cd server && npm run start:dev`: run backend on port `8788`.
- `cd web && npm run dev`: run frontend on port `5173`.
- `cd server && npm run build`: compile NestJS to `dist/`.
- `cd web && npm run build`: type-check and build the Vite app.
- `cd server && npm test`: run Jest unit tests.
- `cd server && npm run test:e2e`: run backend e2e tests.
- `cd server && npm run test:cov`: generate backend coverage.
- `cd server && npm run lint` / `cd web && npm run lint`: run ESLint.

## Coding Style & Naming Conventions
Use TypeScript throughout. Follow the existing 2-space indentation and rely on Prettier + ESLint in `server/` and ESLint in `web/`. Keep NestJS code grouped by feature. Use `*.module.ts`, `*.service.ts`, `*.controller.ts`, and `*.spec.ts` naming on the backend. In React, keep components in PascalCase like `App.tsx`.

## Testing Guidelines
Backend tests use Jest with `*.spec.ts` naming and an e2e suite in `server/test/`. Add or update tests when changing ingest, retrieval, scheduling, or API behavior. For retrieval changes, review or extend the JSON cases in `server/eval/cases/`. No frontend test harness is configured yet, so verify flows manually with `npm run dev`.

## Commit & Pull Request Guidelines
Recent history uses short conventional-style messages such as `feat: ...`, `feat(phase2-3): ...`, `docs: ...`, and `init: ...`. Keep commits focused and use the same pattern. PRs should include a summary, impacted areas, setup or env changes, and screenshots or sample API output for UI/API changes.

## Security & Configuration Tips
Do not commit secrets. Copy `server/.env.example` to `.env` and keep API keys private. Treat `server/uploads/` as runtime data, not source. When changing LLM or embedding settings, document new env vars in `README.md`.
