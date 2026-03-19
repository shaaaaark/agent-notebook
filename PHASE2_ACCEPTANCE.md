# Phase 2-3 验收与阶段成果归档

> 说明：本文档补录了 2026-03-17 前后补齐的 Phase 3 能力项；命令示例统一使用本地后端端口 `6868`。

## 1. 本次验收标准

来源：`ROADMAP.md` 的 Phase 2（Context Builder + 基础可观测）与 Phase 3（Eval 体系）。

1. Context Builder 生效：检索后经文档级去重、覆盖优先、token 预算截断，再进入 prompt。
2. Abstain/Clarify 策略生效：topK 全部 `score < 0.35` 或 selected 为空时返回 clarify/abstain，不调 LLM。
3. 每次请求生成 trace，写入 `server/logs/traces/YYYY-MM-DD.jsonl`，`GET /rag/trace/:request_id` 可查。
4. SSE `done` 事件携带 `request_id`、`final_status`、`sources`。
5. 前端 clarify/abstain 气泡为黄色提示样式，assistant 气泡支持「标记有帮助 / 标记不准确」反馈。
6. `POST /rag/feedback` 可对指定 `request_id` 提交反馈，并回写到 trace。
7. `eval/harness.ts` 可读取 30 个 case、调用 `/rag/ask`、计算 Recall@K 与 Context-hit，输出 `metrics.json` 与 `report.md`。
8. Trace 路径不依赖 `process.cwd()`，支持 `TRACE_LOG_DIR` 配置。
9. `recordFeedback` 对同一 trace 文件串行执行，避免并发覆盖。
10. `eval/harness.ts` 支持 `--compare <baseline> <target>`，输出 run 间差异报告。
11. `eval/collect-failures.ts` 可从 trace 中抽取 clarify / 负反馈样本，沉淀到 `eval/inbox/` 草稿目录。
12. Phase 3 范围明确收口：回归运行、差异对比、失败样本归集已完成；阈值 hard gate、灰度发布、replay 仍归 Phase 5。

---

## 2. 验收执行记录

### 2.1 构建检查

- `server`: `npm run build` 通过
- `web`: `npm run build` 通过

### 2.2 种子导入（沿用 Phase 1）

命令：

```bash
cd server
npx ts-node scripts/seed.ts --dir ../../md-collection/ai_progress --host http://localhost:6868
```

预期：成功 22、跳过 0、失败 0。

### 2.3 检索 + Context Builder 验证

命令：

```bash
curl "http://localhost:6868/rag/retrieve?q=RAG召回不足&k=8"
```

预期：返回 topK chunks，`score` 为正值；RAG 主流程中 Context Builder 会在此基础上做文档级去重、覆盖优先、token 预算截断。

### 2.4 SSE + final_status + request_id 验证

命令：

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"question":"什么是 Agent Loop？请给1句话并标注引用"}' \
  http://localhost:6868/rag/ask
```

预期：

- 流式 `message` 正常返回
- 答案包含引用标注（示例：`[E1]`）
- `event: done` 的 `data` 中包含 `sources`、`request_id`、`final_status`

### 2.5 Clarify 场景验证

命令：

```bash
curl -N -H "Content-Type: application/json" \
  -d '{"question":"量子计算在金融衍生品定价中的具体应用"}' \
  http://localhost:6868/rag/ask
```

预期：知识库无相关文档时，返回 clarify 模板文案，`final_status` 为 `clarify`，不调 LLM。

### 2.6 Trace 查询验证

命令（将 `{request_id}` 替换为 2.4 或 2.5 返回的 `request_id`）：

```bash
curl "http://localhost:6868/rag/trace/{request_id}"
```

预期：返回完整 `RequestTrace` JSON，含 `retrieved_chunks`、`selected_chunks`、`final_status` 等字段。

### 2.7 Feedback 接口验证

命令：

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"request_id":"{request_id}","score":1}' \
  http://localhost:6868/rag/feedback
```

预期：返回 `{ ok: true, request_id, score }`；再次 `GET /rag/trace/{request_id}` 可见 `user_feedback: 1`。

### 2.8 Eval Harness 验证

命令：

```bash
cd server
npx ts-node eval/harness.ts --cases cases --run-id baseline_$(date +%Y%m%d_%H%M) --host http://localhost:6868
```

预期：

- 逐 case 输出 `[case_id] status | recall=Y/N | context=Y/N`
- 生成 `eval/runs/{run_id}/trace.jsonl`、`metrics.json`、`report.md`
- `metrics.json` 含 `recall_at_k`、`context_hit`、`clarify_rate` 等

### 2.9 Harness Compare 补录

命令：

```bash
cd server
npx ts-node eval/harness.ts --compare phase3_real_20260316_1830 phase4_real_20260317_1028
```

补录说明：

- `server/eval/harness.ts` 已支持 compare 模式
- 对比结果会输出到 `eval/runs/{target_run_id}/compare_to_{baseline_run_id}.md`
- 该能力属于 Phase 3 完整闭环的一部分，已在 `server/eval/README.md` 同步说明

### 2.10 Failure Inbox 补录

命令：

```bash
cd server
npx ts-node eval/collect-failures.ts --days 7
```

补录说明：

- 脚本会从 trace 中抽取 `final_status=clarify` 或 `user_feedback=-1` 的失败样本
- 输出目录默认为 `server/eval/inbox/`（gitignore）
- 当前 Phase 4 真实回归仍在排障，因此本次仅补录工具能力，不将临时失败样本直接并入正式 cases

### 2.11 Trace 路径验证

- 从 `server/` 目录启动：trace 写入 `server/logs/traces/`
- 设置 `TRACE_LOG_DIR=/tmp/agent-trace` 后启动：trace 写入 `/tmp/agent-trace/`

---

## 3. 本次改动清单

### 后端新增

- `server/src/modules/context/context-builder.service.ts`
  - 文档级去重（`maxChunksPerSource`）
  - 覆盖优先（`min_incremental_coverage`）
  - token 预算截断（`tokenBudget`）
- `server/src/modules/context/context.module.ts`
- `server/src/modules/trace/trace.service.ts`
  - `write()` 追加 JSONL
  - `getByRequestId()` 按 ID 查询
  - `recordFeedback()` 带文件级互斥锁
  - 路径基于 `__dirname` + `TRACE_LOG_DIR` 配置
- `server/src/modules/trace/trace.module.ts`
- `server/eval/harness.ts`
  - 读取 cases、调用 `/rag/ask`、解析 SSE
  - 计算 Recall@K、Context-hit、citation_presence_rate
  - 输出 trace.jsonl、metrics.json、report.md
  - SSE 格式校验与 fallback，错误时继续跑
- `server/eval/collect-failures.ts`
  - 从 trace 归集 clarify / 负反馈样本
  - 生成待人工补充的 inbox 草稿

### 后端修改

- `server/src/modules/config/app.config.ts`
  - 新增 `context`、`rag`、`guardrails`、`trace` 配置段
- `server/.env.example`
  - 新增 `MAX_CONTEXT_TOKENS`、`MAX_CHUNKS_PER_SOURCE`、`COVERAGE_MIN_GAIN`、`ABSTAIN_THRESHOLD`、`RETRIEVE_TIMEOUT_MS`、`LLM_TIMEOUT_MS`、`TRACE_LOG_DIR`
- `server/src/modules/rag/rag.service.ts`
  - 集成 Context Builder、Abstain/Clarify、Trace 计时
  - 检索/LLM 超时护栏
  - `buildPrompt()` 改为接收 `contextText`
- `server/src/modules/rag/rag.controller.ts`
  - SSE `done` 增加 `request_id`、`final_status`
  - 新增 `GET /rag/trace/:requestId`、`POST /rag/feedback`
- `server/src/modules/rag/rag.module.ts`
  - 导入 `ContextModule`、`TraceModule`
- `server/src/providers/llm.provider.ts`
  - `streamChatCompletion()` 支持 `AbortSignal`、返回 `{ content }`
  - 新增 `complete()` 非流式接口
- `server/eval/cases/*.json`
  - 从 20 个 case 扩充至 30 个
- `server/eval/README.md`
  - 增加目录结构、compare、collect-failures、Phase 3 边界说明
  - 更新 case 统计与 harness 状态

### 前端

- `web/src/App.tsx`
  - 解析 `done` 的 `request_id`、`final_status`
  - 增加 `updateAssistantMeta`、`handleFeedback`
  - clarify 气泡加 `clarify` class
  - 来源面板下方增加 `request_id` 与反馈按钮
- `web/src/App.css`
  - `.bubble.assistant.clarify` 黄色样式
  - `.status-chip`、`.assistant-tools`、`.feedback-actions` 样式

### 其他

- `.gitignore` 增加 `server/logs/`

---

## 4. 改动带来的提升

1. **Context 质量提升**
   - 文档级去重避免单文档垄断
   - 覆盖优先减少重复 chunk 占用 token
   - token 预算截断保证 prompt 可控

2. **可观测性建立**
   - 每次请求生成 trace，可复现、可审计
   - `GET /rag/trace/:id` 支持调试与 replay 输入
   - 用户反馈可回写到 trace，形成闭环

3. **低信心场景处理**
   - clarify/abstain 不调 LLM，降低成本与延迟
   - 敏感词检测区分 abstain 与 clarify

4. **成本与延迟护栏**
   - 检索超时 500ms 降级 clarify
   - LLM 超时 10s 返回 error

5. **Eval 回归体系**
   - 30 个 case、harness 一键跑回归
   - Recall@K、Context-hit 可量化
   - run 间 compare 支持回归 diff
   - failure inbox 支持人工持续补 case

6. **风险修复**
   - Trace 路径不依赖 cwd，支持配置
   - recordFeedback 文件级互斥，避免并发覆盖
   - Harness SSE 解析更健壮，错误时继续跑

---

## 5. 当前已知限制

1. 仍为内存存储，服务重启后数据丢失。
2. 本地向量回退仅用于可用性保障，效果弱于真实 embedding。
3. Trace 查询遍历所有 jsonl 文件，trace 量大时可能变慢。
4. recordFeedback 互斥为单进程内存锁，多实例需外部协调。
5. Feedback 无鉴权与限流，存在滥用风险。
6. 敏感词正则可能误判（如「金融科技发展」）。
7. `eval/inbox/` 仍依赖人工标注与回收，不是全自动评测闭环。

---

## 6. 下一步建议（对齐 ROADMAP）

1. 进入 Phase 4：混合检索（BM25 + RRF + Rerank），目标 Recall@K ≥ 0.8。
2. 稳定 embedding / rerank 运行环境，避免因降级导致大面积 clarify。
3. Phase 5：Policy 参数化（policy.yaml）、回归阈值、灰度分桶、Replay 框架。
4. 持久化与部署：Qdrant、SQLite/PostgreSQL、Docker 化。
