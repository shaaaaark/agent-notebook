# Phase 4 验收与阶段成果归档

> 范围：对齐 `ROADMAP.md` 的 Phase 4「混合检索 + 重排」；命令示例统一使用本地后端端口 `6868`。

## 1. 本次验收标准

1. 检索链路升级为「向量检索 + BM25 + RRF + 本地 rerank」的混合流水线。
2. `/rag/retrieve` 返回混合检索调试字段：`strategy`、`degraded`、`degrade_reason`，以及每个 chunk 的向量/BM25/RRF/rerank 分数与排序位次。
3. rerank 超时或模型不可用时自动降级到 RRF 结果，并保留可观测字段。
4. `GET /ingest/status` 返回 `document_count`、`chunk_count`、`last_updated_at`、`kb_version`。
5. `POST /ingest/reindex` 能基于已追踪文件重建索引，并刷新 `kb_version`。
6. 文件上传落盘名缩短，避免超长原始文件名导致的 `ENAMETOOLONG`。
7. 在 30 个 eval cases 上能完成真实回归并输出 run 产物；阶段目标仍以 `Recall@K >= 0.8` 为准。

---

## 2. 验收执行记录

### 2.1 构建检查

- `server`: `npm run build` 通过

### 2.2 种子导入

命令：

```bash
cd server
npx ts-node scripts/seed.ts --dir /tmp/agent-notebook-eval-notes --host http://localhost:6868
```

结果：

- 成功导入 `22/22`
- 可用于后续 `status`、`reindex`、`retrieve` 与 eval 回归验证

### 2.3 知识库状态接口

命令：

```bash
curl -sS http://localhost:6868/ingest/status
```

结果：

- 正常返回 `document_count`、`chunk_count`、`last_updated_at`、`kb_version`
- 说明摄取追踪与知识库版本状态已可观测

### 2.4 全量重建索引

命令：

```bash
curl -sS -X POST http://localhost:6868/ingest/reindex
```

结果：

- 请求成功
- `kb_version` 发生轮换，证明重建路径已生效

### 2.5 混合检索调试接口

命令：

```bash
curl -sS "http://localhost:6868/rag/retrieve?q=混合检索流水线%20topK_v%20topK_b&k=5"
```

结果：

- `strategy` 返回 `hybrid_rrf`
- 返回 `score_vec`、`score_bm25`、`score_rrf`、`rank_vec`、`rank_bm25`、`rank_final`
- 当前环境下常见 `degraded=true`，`degrade_reason` 为 rerank 模型加载失败或超时

### 2.6 真实回归记录

- run id: `phase4_real_20260317_1028`
- 结果文件：`server/eval/runs/phase4_real_20260317_1028/`
- 关键指标：
  - `Recall@K = 0`
  - `Context-hit = 0`
  - `citation_presence_rate = 0.0333`
  - `clarify_rate = 1`

对比基线 `phase3_real_20260316_1830`：

- `Recall@K`: `0.4333 -> 0`
- `Context-hit`: `0.2333 -> 0`
- `clarify_rate`: `0.6667 -> 1`

结论：Phase 4 能力项已大体落地，但真实回归未达标，当前不能判定为“阶段完成”。

---

## 3. 本次改动清单

### 新增

- `server/src/modules/retrieval/hybrid-retriever.service.ts`
  - 向量检索、BM25、RRF 融合、rerank 编排
- `server/src/modules/retrieval/local-reranker.service.ts`
  - 本地 cross-encoder rerank 与超时降级
- `server/src/modules/retrieval/retrieval.module.ts`
- `server/src/modules/retrieval/retrieval.types.ts`

### 主要修改

- `server/src/modules/rag/rag.service.ts`
  - 改为委托 `HybridRetrieverService`
  - 低信心判断改为兼容多路分数
- `server/src/modules/ingest/ingest.service.ts`
  - 追踪已摄取文件
  - 支持 `reindexAll()` 与知识库状态查询
- `server/src/modules/ingest/ingest.controller.ts`
  - 新增 `GET /ingest/status`、`POST /ingest/reindex`
  - 上传文件名改为时间戳 + 摘要，规避超长路径
- `server/src/modules/trace/trace.service.ts`
  - trace 扩展检索策略、降级原因、混合分数与排序位次
- `server/src/modules/config/app.config.ts`
  - 新增混合检索与 rerank 参数
- `server/package.json`
  - 增加 `wink-bm25-text-search`

---

## 4. 阶段性收益

1. 检索链路从“纯向量”扩展为可调的混合检索，具备进一步拉升 Recall 的工程基础。
2. 知识库状态与全量重建能力补齐，便于做版本化验收和索引回放。
3. 调试面可见性增强，`/rag/retrieve` 和 trace 已能解释每个 chunk 的来源与排序过程。
4. 上传稳定性提升，长文件名不再直接打爆本地 uploads 路径。

## 5. 当前已知限制

1. embedding 健康检查在当前环境返回 `404 page not found`，系统只能回退到本地向量。
2. 本地 rerank 依赖 Hugging Face 模型资源，当前环境下经常加载失败或超时。
3. `phase4_real_20260317_1028` 中 30/30 case 全部 `clarify`，说明混合检索与低信心判定之间仍有回归问题。
4. Phase 4 的核心验收指标 `Recall@K >= 0.8` 尚未达成，因此本阶段仍处于“实现完成、验收未过”的状态。

## 6. 下一步建议

1. 先定位 `rag.service.ts` 的低信心判定与 hybrid 分数语义是否错配。
2. 固定 embedding / rerank 运行环境，避免每次回归都因降级路径被放大。
3. 用 `phase3_real_20260316_1830` 作为基线跑 compare，逐项确认是“召回为空”还是“Context Builder 误杀”。
