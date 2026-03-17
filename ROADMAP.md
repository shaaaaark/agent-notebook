# Agent Notebook — Roadmap

> 目标：在已完成"纯内存结构"的基础上，逐步演进为可用、可扩展、可部署的 NotebookLM-like Agent（NestJS + React + RAG）。
>
> **测试数据集**：`md-collection/ai_progress/` 下 22 篇 RAG/Agent 学习笔记作为贯穿全程的知识库语料。

---

## 0. 当前基线（已完成）

- ✅ 纯内存文档存储（`Document[]` 数组，重启丢失）
- ✅ RAG 问答接口雏形（取最后 5 条文档拼接 context）
- ✅ 前端基础聊天 UI + SSE 流式显示
- ✅ 文件上传拖拽区域（支持 .md / .txt / .pdf）
- ✅ `.gitignore` 覆盖全项目（保护 `.env`、`uploads/`）

**现存主要问题：**
- `ingest.service.ts`：全文不切块，超长文档直接截断
- `rag.service.ts`：`buildPrompt` 用时间顺序而非相关度取 context
- `llm.provider.ts`：`embeddings` 已初始化但完全未使用
- prompt 无引用约束，输出无来源标注，模型可能无中生有
- 零可观测：无 request trace，无法复现线上问题

---

## 1. MVP 可用化（第 1–2 周）

**目标：做到「上传 → 分块 → 向量检索 → 带引用回答」的完整闭环。**

> 测试数据：把 `md-collection/ai_progress/` 22 篇笔记全部上传，验证 RAG 能否准确召回并引用具体段落。

### 1.1 文档分块（Ingest 改造）

**改动文件：** `server/src/modules/ingest/ingest.service.ts`

- [ ] **Sliding-window 分块**
  - 默认 `CHUNK_SIZE=500` 字符，`STEP=200`（overlap 300）
  - 每块携带 `metadata: { source, chunk_id: "${filename}#${offset}", chunk_index, total_chunks }`
  - 通过 `.env` 暴露参数：`CHUNK_SIZE` / `CHUNK_STEP`

- [ ] **文件去重**（防重传）
  - 对文件内容做 `sha256` hash，同 hash 跳过摄取并返回 `{ skipped: true }`

- [ ] **增量更新支持**（对应笔记 `2026-03-13_ai_progress_1531.md`）
  - 摄取时按 `chunk_id` 判断是否已存在（hash 相同跳过，hash 变化则替换）
  - 文件删除时软删除对应 chunk（`active: false`），不立即清理向量

```typescript
// ingest.service.ts 核心逻辑示意
private chunk(text: string, source: string): Document[] {
  const SIZE = +process.env.CHUNK_SIZE! || 500
  const STEP = +process.env.CHUNK_STEP! || 200
  const chunks: Document[] = []
  for (let i = 0; i < text.length; i += STEP) {
    const content = text.slice(i, i + SIZE)
    chunks.push(new Document({
      pageContent: content,
      metadata: {
        source,
        chunk_id: `${source}#${i}`,
        chunk_index: Math.floor(i / STEP),
      },
    }))
    if (i + SIZE >= text.length) break
  }
  return chunks
}
```

### 1.2 向量化与检索（RagService 升级）

**改动文件：** `server/src/modules/rag/rag.service.ts`、`server/src/providers/llm.provider.ts`

- [ ] **向量存储**：在 `addDocuments()` 时调用 `llm.embeddings.embedDocuments()` 生成向量，与 chunk 一起存入内存（`{ doc, vec: number[] }`）

- [ ] **余弦相似度检索**，替换"取最后 5 条"：
  ```typescript
  async retrieve(question: string, topK = 8): Promise<RetrievedChunk[]> {
    const qVec = await this.llm.embeddings.embedQuery(question)
    return this.store
      .map(item => ({ ...item, score: cosine(qVec, item.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
  ```

- [ ] **新增 `GET /rag/retrieve`**：接收 `q` 参数，返回 topK chunks + scores（用于调试，对应笔记 `2026-03-13_ai_progress_1610.md`）

- [ ] **`max_tokens` 从硬编码 512 改为 env 参数** `LLM_MAX_TOKENS`（默认 1024）

### 1.3 Prompt 工程：引用约束 + 来源标注

**改动文件：** `server/src/modules/rag/rag.service.ts`

- [ ] **证据编号格式** `[E1]...[En]`，每个 chunk 标注来源文件名
  ```typescript
  private buildPrompt(question: string, docs: RetrievedChunk[]): string {
    const evidence = docs.map((d, i) =>
      `[E${i + 1}] 来源：${d.doc.metadata.source}\n${d.doc.pageContent}`
    ).join('\n\n---\n\n')

    return `你是知识库助手。请严格基于以下证据回答，每个论点须标注证据编号如 [E1]。
若证据不足，回复"根据现有资料无法回答，建议补充相关文档"，不得编造内容。

${evidence}

问题：${question}`
  }
  ```

- [ ] **response 格式**：SSE `done` 事件附带 `sources` 数组（chunk_id + filename + score）

### 1.4 种子数据脚本

- [ ] 新增 `server/scripts/seed.ts`：读取 `md-collection/ai_progress/` 全部 22 篇笔记，批量调用 `/ingest/file` 接口，生成基准知识库
  ```bash
  # 一键导入所有学习笔记
  npx ts-node scripts/seed.ts --dir ../../md-collection/ai_progress
  ```

---

## 2. Context Builder + 基础可观测（第 2–3 周）

**目标：context 构建有策略、有日志，可复现线上问题。**

> 测试数据：用笔记中的"自测题"（每篇末尾的问题）构建第一批 eval cases。

### 2.1 Context Builder 模块（新增）

**新文件：** `server/src/modules/context/context-builder.service.ts`（对应笔记 `2026-03-13_ai_progress_1843.md`、`2026-03-13_ai_progress_1729.md`）

```typescript
interface ContextBuilderInput {
  query: string
  candidates: RetrievedChunk[]   // topK 候选
  tokenBudget: number            // 默认 2000 tokens
}

interface ContextBuilderOutput {
  selected: RetrievedChunk[]     // 最终进入 context 的 chunks
  skipped: { chunk: RetrievedChunk; reason: string }[]
  contextText: string
  stats: { selectedCount: number; tokenUsed: number; truncated: boolean }
}
```

三条核心策略：
- [ ] **文档级去重**：同一 `source` 文件最多保留 2 个 chunk（防单文档垄断）
- [ ] **覆盖优先**：连续两个 chunk 相似度差值 < 0.05 时，后者跳过（边际增益阈值过滤）
- [ ] **token 预算截断**：超出 `tokenBudget` 时截断，记录 `truncated: true`

### 2.2 Abstain / Clarify 策略（对应笔记 `2026-03-14_ai_progress_1230.md`）

**改动文件：** `server/src/modules/rag/rag.service.ts`

- [ ] **触发条件**：topK 全部 `score < ABSTAIN_THRESHOLD`（默认 0.35）或 `selected.length === 0`
- [ ] **Clarify 输出模板**：
  ```
  当前知识库中未找到与「{question}」相关的证据。
  建议：① 上传相关文档后重新提问；② 换一种表述方式。
  ```
- [ ] **`final_status` 枚举**：`success | clarify | abstain | error`，写入 trace 和 SSE done 事件

### 2.3 Request-Level Trace（对应笔记 `2026-03-14_ai_progress_1045.md`）

**新文件：** `server/src/modules/trace/trace.service.ts`

每次请求生成一条结构化日志，包含：

```typescript
interface RequestTrace {
  request_id: string          // crypto.randomUUID()
  timestamp: string
  query_raw: string
  // 检索阶段
  retrieve_topK: number
  retrieved_chunks: { chunk_id: string; score: number }[]
  retrieve_latency_ms: number
  // Context 构建
  selected_chunks: string[]   // chunk_id 列表（用于 replay）
  skipped_reasons: Record<string, number>  // reason -> count
  token_used: number
  truncated: boolean
  // 生成阶段
  model: string
  prompt_tokens: number
  completion_tokens: number
  generate_latency_ms: number
  // 结果
  answer_hash: string         // md5(answer) 用于 diff 不存原文
  citations_parsed: string[]  // [E1][E3] → ['E1','E3']
  final_status: string
}
```

- [ ] 日志写入 `server/logs/traces/YYYY-MM-DD.jsonl`（每行一条 JSON）
- [ ] `GET /rag/trace/:request_id` 接口：按 ID 查询单条 trace（调试用）

### 2.4 成本/延迟护栏（对应笔记 `2026-03-14_ai_progress_1151.md`）

**改动文件：** `server/src/providers/llm.provider.ts`

- [ ] 检索超时：`RETRIEVE_TIMEOUT_MS=500`，超时降级为空 context + clarify
- [ ] LLM 超时：`LLM_TIMEOUT_MS=10000`
- [ ] `max_tokens` 上限：`LLM_MAX_TOKENS=1024`，可通过 env 覆盖
- [ ] 请求级 token 预算：超出 `MAX_CONTEXT_TOKENS`（默认 2000）时触发 Context Builder 截断

---

## 3. Eval 体系（第 3–4 周）

**目标：每次改策略都能跑回归，有数据支撑决策。**

> 测试数据：从 22 篇笔记的自测题 + 笔记内关键问题构建 ~30 个 eval cases。

### 3.1 Eval Case 格式（对应笔记 `2026-03-13_ai_progress_1920.md`）

**新目录：** `server/eval/cases/`

```json
{
  "case_id": "rag-001",
  "question": "RAG 生产环境中召回不足的根本原因是什么？",
  "expected_points": ["分块策略", "嵌入质量", "过滤条件过严"],
  "must_cite": true,
  "gold_sources": ["2026-03-11_ai_progress_1834.md"],
  "constraints": ["不得提及与 RAG 无关的内容"]
}
```

初始 Eval Cases 构建计划（直接从笔记提取）：

| case_id | 问题来源笔记 | 知识点 |
|---|---|---|
| `rag-001` | `2026-03-11_ai_progress_1834` | RAG 召回不足原因 |
| `rag-002` | `2026-03-11_ai_progress_1942` | prompt 引用约束模板 |
| `agent-001` | `2026-03-12_ai_progress_1650` | Agent Loop 7步骤 |
| `ingest-001` | `2026-03-13_ai_progress_1531` | 增量更新三层数据模型 |
| `retrieval-001` | `2026-03-13_ai_progress_1651` | 混合检索参数（topK_v/topK_b）|
| `context-001` | `2026-03-13_ai_progress_1729` | Context 覆盖优先策略 |
| `eval-001` | `2026-03-13_ai_progress_1920` | Recall@K 定义 |
| `citation-001` | `2026-03-13_ai_progress_2030` | 引用正确率自动评分方法 |
| `trace-001` | `2026-03-14_ai_progress_1045` | trace 最小字段集 |
| `guardrail-001` | `2026-03-14_ai_progress_1151` | 延迟护栏分级 |
| `abstain-001` | `2026-03-14_ai_progress_1230` | Abstain 触发条件 |
| `release-001` | `2026-03-14_ai_progress_1010` | Policy 参数化目的 |

### 3.2 Eval Harness 脚本（对应笔记 `2026-03-13_ai_progress_1955.md`）

**新文件：** `server/eval/harness.ts`

```
eval/
  cases/               ← JSON case 文件（约 30 个）
  runs/
    {run_id}/
      trace.jsonl      ← 每个 case 的完整 trace
      metrics.json     ← Recall@K, Context-hit, citation_correct_rate
      report.md        ← 自动生成的对比报告
  harness.ts
```

**MVP 两个指标**（对应笔记 `2026-03-13_ai_progress_1920.md`）：
- `Recall@K`：gold_source 是否出现在 topK 检索结果中
- `Context-hit`：gold_source 是否进入最终 context（衡量 Context Builder 过滤是否误杀）

```bash
# 跑回归
npx ts-node eval/harness.ts --cases cases/ --run-id $(date +%Y%m%d_%H%M)
```

- [x] 支持 `--compare <baseline> <target>` 输出差异报告
- [x] 回归目录沉淀 `trace.jsonl / metrics.json / report.md`

### 3.3 失败案例自动归集（对应笔记 `2026-03-13_ai_progress_1610.md`）

- [x] 在 trace 中记录 `user_feedback`（前端拇指下/上按钮，后续通过 `POST /rag/feedback` 写入）
- [x] 每周从 `logs/traces/` 抽取 `final_status=clarify` 或有 feedback=-1 的 trace，人工标注后补充进 `eval/cases/`

> Phase 3 边界说明：回归运行、run 对比、失败样本归集已完成；`thresholds.yaml`、自动 hard gate、灰度发布、replay 仍在 Phase 5。

---

## 4. 混合检索 + 重排（第 4–5 周）

**目标：召回质量从"凑合"到"可量化的 Recall@K ≥ 0.8"。**

> 验证指标：在 3.1 的 eval cases 上跑 Recall@K，目标从基线 ~0.5 提升到 ≥ 0.8。

### 4.1 混合检索（对应笔记 `2026-03-13_ai_progress_1651.md`）

**新文件：** `server/src/modules/retrieval/hybrid-retriever.service.ts`

完整检索流水线：
```
query normalization
  → 向量检索（topK_v=50）+ BM25（topK_b=50）
  → 去重合并（by chunk_id）
  → RRF 融合排序（topN=30）
  → Rerank（topM=8）
  → Context Builder
  → 生成
```

- [ ] **BM25**：使用 `wink-bm25-text-search` 或 `flexsearch`，在摄取时建倒排索引
- [ ] **RRF 融合**：`score_rrf = Σ 1/(rank_i + 60)`（对应笔记推荐值）
- [ ] **参数全部走 env**：`RETRIEVE_TOP_K_VEC`、`RETRIEVE_TOP_K_BM25`、`RERANK_TOP_M`

### 4.2 Rerank（对应笔记 `2026-03-13_ai_progress_1651.md`）

- [ ] **本地 rerank**：用 `@xenova/transformers`（项目已安装）加载 `cross-encoder/ms-marco-MiniLM-L-6-v2`，对 query × chunk 打分
- [ ] **降级策略**：rerank 超时（`RERANK_TIMEOUT_MS=500`）时直接用 RRF 结果，记录 `rerank_skipped: true` 进 trace

### 4.3 知识库版本管理（对应笔记 `2026-03-13_ai_progress_1531.md`）

- [ ] 每次全量重索引生成新 `kb_version` 标识
- [ ] `GET /ingest/status` 返回：当前文档数、chunk 数、最后更新时间、kb_version
- [ ] 支持"重新索引"操作（清空向量、重新分块、重新 embedding）

---

## 5. 工程化：参数化发布 + 灰度（第 5–6 周）

**目标：所有策略改动可回滚、可对比、可复现。**

### 5.1 Policy 参数化（对应笔记 `2026-03-14_ai_progress_1010.md`）

**新文件：** `server/config/policy.yaml`

```yaml
policy_version: "v0.3.0"
retrieval:
  top_k_vec: 50
  top_k_bm25: 50
  rerank_top_m: 8
  min_score_threshold: 0.35   # Abstain 触发线
context:
  token_budget: 2000
  max_chunks_per_source: 2
  coverage_min_gain: 0.05
generation:
  model: gpt-4o-mini
  max_tokens: 1024
  temperature: 0.3
```

- [ ] 每条 trace 写入当时的 `policy_version`
- [ ] 切换策略只改 `policy.yaml`，不改代码

### 5.2 回归阈值设计（对应笔记 `2026-03-16_ai_progress_1202.md`）

**新文件：** `server/eval/thresholds.yaml`

```yaml
hard_gates:                     # 自动回滚
  citation_correct_rate: -0.02  # 下降 >2% 触发
  abstain_rate: +0.02           # 上升 >2% 触发
  p95_latency_ms: +15           # 上升 >15% 触发
soft_gates:                     # 人工 review
  recall_at_k: -0.03
  context_hit: -0.03
```

- [ ] Eval Harness 对比两个 `run_id`，超过 hard gate 时输出 `ROLLBACK REQUIRED` + 具体 delta

### 5.3 灰度分桶设计（对应笔记 `2026-03-16_ai_progress_1236.md`）

- [ ] trace 写入 `bucket_id`：`hash(user_id_hash) % 100`（无 user_id 时用 `request_id`）
- [ ] 新策略路由 `bucket < 5`（5% 流量），同时记录 `is_ab_group: true`
- [ ] `GET /rag/ab-report?window=24h` 对比两组的 `Recall@K`、`abstain_rate`、`p95_latency`

### 5.4 Replay 框架（对应笔记 `2026-03-16_ai_progress_1309.md`）

**新文件：** `server/eval/replay.ts`

```
replay(request_id):
  读 trace → 重建 retrieve 候选（用 cached chunk_id list）
  → 按 policy_version 参数重跑 Context Builder + 生成
  → diff(new_answer, original_answer_hash)
  → 输出 replay_result.json
```

- [ ] trace 里保存 `replay_input.json`（最小闭包：query + filters + candidate_chunk_ids + policy_version）
- [ ] replay 可直接作为 eval case 的 "回归输入"

---

## 6. 体验与前端增强（第 3–4 周，可与 3–5 并行）

### 6.1 来源可视化

- [ ] SSE `done` 事件附带 `sources: [{chunk_id, source, score, snippet}]`
- [ ] 前端气泡下方展示来源折叠面板（文件名 + 相关片段 + 相似度分）
- [ ] `final_status=clarify` 时特殊样式（黄色提示框而非普通气泡）

### 6.2 文件库管理

- [ ] `GET /ingest/files` 返回已摄取文件列表（文件名、chunks 数、摄取时间）
- [ ] 前端侧边栏"知识库"标签页：展示文件列表、支持删除单个文件
- [ ] 文件删除后触发 chunk 软删除 + 向量清理

### 6.3 对话历史

- [ ] 前端本地存储（`localStorage`）多轮会话，展示历史消息
- [ ] 发送时携带最近 3 轮上下文拼入 prompt（多轮对话支持）

### 6.4 每日复习摘要（复活 Cron）

- [ ] `review.job.ts` 改为真实摘要：取最近 24h 上传的文档，生成"今日新增知识点摘要"
- [ ] 摘要写入 `ReviewLog` 表，前端侧边栏展示"今日摘要"卡片
- [ ] 支持推送（Telegram Bot / 系统通知）

---

## 7. 持久化与部署（第 6–8 周）

### 7.1 持久化

- [ ] **向量库**：引入 `Qdrant`（Docker 部署），替换内存存储；`VECTOR_STORE=qdrant` 配置切换
- [ ] **元数据库**：`SQLite`（本地）或 `PostgreSQL`（生产），存文档记录、traces、review logs
- [ ] **Session 持久化**：会话 ID → 对话记录写入 DB

### 7.2 Docker 化

- [ ] `docker-compose.yml`：`server` + `web(nginx)` + `qdrant` 三容器
- [ ] 环境变量统一通过 `.env` 注入，`server/.env.example` 同步更新所有新增参数

### 7.3 监控

- [ ] `GET /metrics`：暴露 `total_requests`、`abstain_rate`、`avg_latency_ms`、`token_cost_total`
- [ ] 费用告警：`token_cost_total` 超过 `COST_ALERT_USD` 时写 warn 日志

---

## 里程碑

| 里程碑 | 目标周 | 交付标准 |
|---|---|---|
| **M1 — MVP 闭环** | 第 2 周 | 22 篇笔记导入后，能基于向量检索并带 `[E1]` 引用回答 |
| **M2 — 可观测** | 第 3 周 | 每次请求生成 trace，`/rag/trace/:id` 可查；Abstain 策略生效 |
| **M3 — Eval 体系** | 第 4 周 | 30 个 eval cases，`harness.ts` 输出 `Recall@K ≥ 0.5`（基线） |
| **M4 — 混合检索** | 第 5 周 | BM25 + 向量 + Rerank，`Recall@K ≥ 0.8` |
| **M5 — 参数化发布** | 第 6 周 | policy.yaml 驱动，支持 replay，hard gate 自动告警 |
| **M6 — 持久化部署** | 第 8 周 | Docker 一键起全栈，数据重启不丢失 |

---

## 参考笔记索引

> 每项任务对应的学习笔记（均在 `md-collection/ai_progress/`）

| 任务模块 | 对应笔记 |
|---|---|
| 分块策略 + 增量更新 | `2026-03-13_ai_progress_1531.md` |
| 混合检索流水线 | `2026-03-13_ai_progress_1651.md` |
| Context Builder 接口设计 | `2026-03-13_ai_progress_1843.md` |
| Context 去重/覆盖策略 | `2026-03-13_ai_progress_1729.md` |
| RAG 可观测性 + 调试路径 | `2026-03-13_ai_progress_1610.md` |
| Eval Case 格式 + 指标 | `2026-03-13_ai_progress_1920.md` |
| Eval Harness 实现 | `2026-03-13_ai_progress_1955.md` |
| 引用正确率自动评分 | `2026-03-13_ai_progress_2030.md` |
| Trace 最小字段集 | `2026-03-14_ai_progress_1045.md` |
| 成本/延迟护栏 | `2026-03-14_ai_progress_1151.md` |
| Abstain / Clarify 策略 | `2026-03-14_ai_progress_1230.md` |
| Policy 参数化 + 回滚 | `2026-03-14_ai_progress_1010.md` |
| 回归阈值设计 | `2026-03-16_ai_progress_1202.md` |
| 灰度分桶设计 | `2026-03-16_ai_progress_1236.md` |
| Replay 框架 | `2026-03-16_ai_progress_1309.md` |
| Prompt 引用约束 | `2026-03-11_ai_progress_1942.md` |
| 生产 RAG 问题排查 | `2026-03-11_ai_progress_1834.md` |
| Agent Loop + Context Engineering | `2026-03-12_ai_progress_1650.md` |
