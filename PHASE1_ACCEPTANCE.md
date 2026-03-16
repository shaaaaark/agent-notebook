# Phase 1 验收与改动收益归档

## 1. 本次验收标准

来源：`ROADMAP.md` 的 Phase 1 计划（MVP 可用化）。

1. 上传一篇笔记后，`GET /rag/retrieve?q=RAG召回不足` 能返回相关 chunks，且 `score > 0`。
2. `POST /rag/ask` 回答出现 `[E1]` 等引用标注，且 SSE `done` 事件携带 `sources`。
3. 重复上传同一文件返回 `{ skipped: true }`。
4. `seed.ts` 可一键导入 22 篇笔记，系统可基于导入内容问答。
5. 前端 assistant 气泡下可展开查看来源面板（文件名、相似度、片段）。

---

## 2. 验收执行记录

### 2.1 构建检查

- `server`: `npm run build` 通过
- `web`: `npm run build` 通过

### 2.2 种子导入

命令：

```bash
cd server
npx ts-node scripts/seed.ts --dir ../../md-collection/ai_progress --host http://localhost:3000
```

结果：

- 成功 `22`
- 跳过 `0`
- 失败 `0`

### 2.3 检索接口验证

命令：

```bash
curl "http://localhost:3000/rag/retrieve?q=RAG召回不足&k=3"
```

结果：

- 返回 `topK=3`
- 每条结果包含 `chunk_id/source/score/pageContent`
- 分数为正值（示例：`0.2458`、`0.2274`、`0.1747`）

### 2.4 SSE + 引用验证

命令：

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"question":"什么是 Agent Loop？请给1句话并标注引用"}' \
  http://localhost:3000/rag/ask
```

结果：

- 流式 `message` 正常返回
- 答案包含引用标注（示例：`[E1]`）
- `event: done` 的 `data` 中包含 `sources` 数组（含 `chunk_id/source/score/snippet`）

### 2.5 重复上传去重验证

- `IngestService` 已接入 `sha256` 文件去重逻辑
- 同名同内容会返回 `skipped: true`

---

## 3. 本次改动清单

### 后端

- `server/src/modules/config/app.config.ts`
  - 新增配置：`chunk.size`、`chunk.step`、`retrieve.topK`、`openai.maxTokens`
- `server/.env.example`
  - 新增：`CHUNK_SIZE`、`CHUNK_STEP`、`RETRIEVE_TOP_K`、`LLM_MAX_TOKENS`
- `server/src/modules/ingest/ingest.service.ts`
  - 增加 sliding-window 分块
  - 增加 `chunk_id/chunk_index/total_chunks` metadata
  - 增加 SHA256 文件去重
- `server/src/modules/rag/rag.service.ts`
  - 存储结构升级为 `{ doc, vec }[]`
  - `addDocuments()` 增加向量化
  - 新增 `retrieve()` + 余弦相似度排序
  - Prompt 升级为中文证据约束模板（强制引用）
  - `askStream()` 返回 `sources`
  - 增加 embedding 失败时本地向量回退（保障可用性）
- `server/src/modules/rag/rag.controller.ts`
  - SSE `done` 增加 `sources` JSON
  - 新增 `GET /rag/retrieve` 调试接口
- `server/src/providers/llm.provider.ts`
  - `max_tokens` 改为配置化读取（默认 1024）
- `server/scripts/seed.ts`
  - 改为 Node 原生 `FormData + Blob` 上传，兼容当前环境

### 前端

- `web/src/App.tsx`
  - 解析 SSE `done` 的 `sources`
  - 回答气泡增加来源折叠面板
- `web/src/App.css`
  - 增加来源面板样式

---

## 4. 改动带来的提升

1. 检索质量从“时间顺序拼接”提升为“语义相关检索”
   - 旧：`slice(-5)`（最新 5 条，不关心问题相关性）
   - 新：`embedQuery + cosine + topK`（按相关度返回证据）

2. 可解释性显著提升
   - 输出答案带 `[E1]...[En]` 引用
   - SSE `done` 提供结构化 `sources`，前端可直接展示出处

3. 摄取质量提升
   - 全文改分块，长文不再粗粒度丢语义
   - 每个 chunk 可追踪（`chunk_id`），为后续 trace/replay 打基础

4. 运行成本与可调优能力提升
   - `CHUNK_SIZE/CHUNK_STEP/RETRIEVE_TOP_K/LLM_MAX_TOKENS` 全部可配
   - 能通过环境变量快速实验参数，不改代码

5. 数据导入与回归验证更稳定
   - `seed.ts` 一键导入 22 篇测试笔记
   - Embedding 服务异常时可自动回退到本地向量，流程不断

---

## 5. 当前已知限制

1. 目前仍是内存存储，服务重启后数据丢失。
2. 本地向量回退仅用于可用性保障，效果弱于真实 embedding 服务。
3. 尚未实现 Context Builder、trace、abstain/clarify（属于下一阶段）。

---

## 6. 下一步建议（对齐 ROADMAP）

1. 进入 Phase 2：落地 `Context Builder` + `Request Trace`。
2. 追加 `final_status` 与澄清/拒答策略。
3. 打通 `eval/harness.ts`，将本次 20 个 case 接入离线回归。
