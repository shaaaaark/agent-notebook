# Phase 5 Rerank Smoke Verification

## 目标

把 Bailian rerank 的验证从临时脚本整理成正式资产，覆盖两层：

1. **Router 真实 Bailian 调用**：证明应用配置下 `RerankerRouterService` 实际选中 `bailian` 并返回真实 `rerank_score`
2. **Retrieve 全链路验证**：证明 `/rag/retrieve` 在真实知识库数据上会暴露 `rerank_provider / rerank_skipped / rerank_reason`，并在命中时输出 `rerank_score`

## 资产位置

- `server/scripts/rerank-router-smoke.ts`
  - 直连 `RerankerRouterService`
  - 不依赖 retrieval 候选门控
  - 用于验证 Bailian provider 接入、鉴权、协议和返回解析
- `server/scripts/seed.ts`
  - 导入 `md-collection/ai_progress/` 真实知识库数据
- HTTP smoke（手工步骤）
  - 通过 `/rag/retrieve` 或 `/rag/ask` 做全链路验证
  - 观测字段来自 API 与 trace

## 前置条件

后端 `.env` 需包含：

- `RERANK_PROVIDER=bailian`
- `BAILIAN_RERANK_BASE_URL=https://dashscope.aliyuncs.com`
- `BAILIAN_RERANK_API_KEY=...`
- `BAILIAN_RERANK_MODEL=qwen3-vl-rerank`

## 验证 1：Router 真实 Bailian 调用

在 `server/` 下执行：

```bash
/home/xiaoma/.nvm/versions/node/v22.22.1/bin/node \
  -r ts-node/register \
  -r tsconfig-paths/register \
  scripts/rerank-router-smoke.ts
```

预期：

- `provider` 为 `bailian`
- `skipped` 为 `false`
- `chunks[]` 中存在真实 `rerank_score`

示例结果：

```json
{
  "provider": "bailian",
  "skipped": false,
  "latencyMs": 265,
  "chunks": [
    {
      "chunk_id": "smoke-a-1",
      "source": "smoke-a.md",
      "rerank_score": 0.9740,
      "rank_final": 1
    },
    {
      "chunk_id": "smoke-b-1",
      "source": "smoke-b.md",
      "rerank_score": 0.3254,
      "rank_final": 2
    }
  ]
}
```

## 验证 2：Retrieve 全链路 smoke

### 1) 启后端

```bash
/home/xiaoma/.nvm/versions/node/v22.22.1/bin/node dist/src/main.js
```

### 2) 导入真实知识库

```bash
/home/xiaoma/.nvm/versions/node/v22.22.1/bin/node \
  -r ts-node/register \
  scripts/seed.ts \
  --dir /home/xiaoma/.nanobot/workspace/md-collection/ai_progress \
  --host http://127.0.0.1:9527 \
  --reset
```

### 3) 调 `/rag/retrieve`

```bash
curl -s "http://127.0.0.1:9527/rag/retrieve?q=RAG%20%E7%94%9F%E4%BA%A7%E7%8E%AF%E5%A2%83%E4%B8%AD%E5%8F%AC%E5%9B%9E%E4%B8%8D%E8%B6%B3%E7%9A%84%E6%A0%B9%E6%9C%AC%E5%8E%9F%E5%9B%A0%E6%98%AF%E4%BB%80%E4%B9%88&k=5"
```

### 4) 观察点

响应顶层至少应包含：

- `strategy`
- `degraded`
- `rerank_provider`
- `rerank_skipped`
- `rerank_reason`（若跳过）

命中 rerank 时，`chunks[]` 中应包含：

- `rerank_score`
- `rank_final`

## Trace 观测字段

`/rag/ask` 生成 trace 后，可通过 `/rag/trace/:request_id` 检查：

- `rerank_provider`
- `rerank_skipped`
- `rerank_reason`
- `retrieved_chunks[].rerank_score`

## 当前已验证结论

- Bailian 原生 rerank 协议已改对
- 应用配置下 router 已真实调到 Bailian
- retrieval/trace/API 现在都暴露 rerank 可观测字段
- 极小语料（1~3 条）不适合作为全链路 smoke 基线，因为 retrieval 候选门控可能先于 rerank 生效
- `rrf_k=60` 下原默认 `min_rrf_score=0.05` 与 RRF 分数区间不一致，会把 hybrid 候选几乎全部筛空；现已调整为 `0.02`

## 最新真实全链路证据（22 篇 ai_progress 知识库）

导入：

```bash
/home/xiaoma/.nvm/versions/node/v22.22.1/bin/node \
  -r ts-node/register scripts/seed.ts \
  --dir /home/xiaoma/.nanobot/workspace/md-collection/ai_progress \
  --host http://127.0.0.1:9527 --reset
```

### 样例 1：/rag/retrieve

Query:

```text
Context Builder 接口设计包含哪些核心输入输出
```

结果要点：

```json
{
  "strategy": "hybrid_rrf_rerank",
  "degraded": false,
  "rerank_provider": "bailian",
  "rerank_skipped": false,
  "topK": 5,
  "chunks": [
    {
      "chunk_id": "2026-03-13_ai_progress_1843.md#0",
      "source": "2026-03-13_ai_progress_1843.md",
      "score_rrf": 0.0328,
      "rerank_score": 0.9211,
      "rank_final": 1
    },
    {
      "chunk_id": "2026-03-13_ai_progress_1843.md#200",
      "source": "2026-03-13_ai_progress_1843.md",
      "score_rrf": 0.0311,
      "rerank_score": 0.8741,
      "rank_final": 2
    }
  ]
}
```

这条证据说明：

- retrieval 候选非空
- hybrid + rerank 主链路真实生效
- Bailian 返回的 `rerank_score` 已进入 API 响应

### 样例 2：/rag/retrieve

Query:

```text
RAG 生产环境中召回不足的根本原因是什么
```

结果片段：

```json
{
  "strategy": "hybrid_rrf_rerank",
  "degraded": false,
  "rerank_provider": "bailian",
  "rerank_skipped": false,
  "topK": 5,
  "chunks": [
    {
      "chunk_id": "2026-03-11_ai_progress_1834.md#0",
      "source": "2026-03-11_ai_progress_1834.md",
      "score_rrf": 0.0285,
      "rerank_score": 0.8384,
      "rank_final": 1
    }
  ]
}
```

### 样例 3：/rag/ask -> trace

已验证 trace 会落下：

- `rerank_provider`
- `rerank_skipped`
- `rerank_reason`
- `retrieved_chunks[].rerank_score`

示例 request id：

```text
b9aa29c6-5916-4baf-881b-01c67463ce83
```
