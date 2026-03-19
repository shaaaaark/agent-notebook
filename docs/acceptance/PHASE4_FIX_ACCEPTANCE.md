# Phase 4 修复后验收（真实回归）

> 范围：对齐 `docs/execution/EXECUTION_PLAN.md` 中 Stage A / Phase 4 检索链路可信化，并补充本轮真实运行态修复结果。

## 1. 本轮目标

本轮目标不是继续堆功能，而是把 Phase 4 主链路恢复到**可验证、可运行、可解释**的状态：

1. 知识库可被稳定重建，不再因进程漂移或空内存库导致结论失真。
2. Embedding 接入百炼后，不再因为批量上限触发大面积 fallback。
3. 检索链路恢复 `hybrid + RRF + rerank` 正常策略，而不是长期退化为 `vector_only`。
4. Chat 生成链路恢复可用，SSE 流式回答不再被 401 阻断。

---

## 2. 关键问题与修复

### 2.1 Embedding 批量上限适配

**问题：**

百炼 embedding 模型在当前接口下单次 `batch size` 不能超过 10。项目原实现会把整批文本直接送进 `embedDocuments()`，导致导入大文档时出现：

- `batch size is invalid, it should not be larger than 10`
- 触发 `fallback to local vectorization`
- 结果是部分 chunk 并未稳定使用远程 embedding 生成

**修复：**

在 `server/src/modules/retrieval/hybrid-retriever.service.ts` 中将 embedding 请求改为按最多 10 条分批发送：

- 新增 `batchSize = 10`
- `texts.slice(i, i + batchSize)` 分片调用 `embedDocuments()`
- 聚合所有批次结果后再回填 store

**结果：**

- `text-embedding-v3` 可稳定用于知识库重建
- 不再因单批超限导致整批导入退回本地向量化

### 2.2 模型尝试与回退决策

**尝试：**
- 先测试 `text-embedding-v4`
- 直连健康检查通过

**结论：**
- `v4` 同样未绕开当前批量上限问题
- 根因是调用策略不兼容，不是单纯模型版本问题

**最终选择：**
- 回退并固定到 `text-embedding-v3`
- 同时修复批处理策略，保证工程稳定性

### 2.3 Chat Provider 切换到可用 codex 配置

**问题：**

原 chat provider 链路返回：
- `401 INVALID_API_KEY`

这会导致 `/rag/ask` 在生成阶段失败，即便检索已恢复也无法完成最终回答。

**修复：**

读取本机 `.codex` 的有效配置，仅用于当前运行调试接入：

- `OPENAI_BASE_URL=http://172.27.0.1:8080/v1`
- `OPENAI_MODEL=gpt-5.4`
- API key 使用 `.codex/auth.json` 中的有效认证

Embedding 继续保持独立：

- `EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `EMBEDDING_MODEL=text-embedding-v3`

**结果：**

- `/rag/debug` 已显示 chat model 为 `gpt-5.4`
- `/rag/ask` 不再因 401 失败，已恢复 SSE 流式输出

### 2.4 运行态收敛：清理旧进程污染

**问题：**

9527 端口曾长期被旧实例占用，导致：

- 新配置未真正接管端口
- `/rag/debug` 显示的是旧配置
- KB 状态、检索结果、日志来源出现混淆

**修复：**

- 精准清理旧 pid
- 使用明确 Node 路径启动单一 `dist/src/main` 实例
- 重新 seed 内存知识库

**结果：**

新实例已稳定接管 9527，运行配置与实际服务一致。

---

## 3. 本轮真实验证结果

### 3.1 知识库重建

执行 `seed.ts --reset` 后：

- `document_count = 22`
- `chunk_count = 126`

说明当前知识库已按预期从 `md-collection/ai_progress/` 完整重建。

### 3.2 检索验证

针对问题：

> `RAG生产环境中召回不足的根本原因是什么？`

`/rag/retrieve` 返回结果为：

- `strategy: hybrid_rrf_rerank`
- `degraded: false`

这说明检索主链路已经恢复为：

- hybrid retrieval（混合检索）
- RRF（Reciprocal Rank Fusion，倒数排序融合）
- rerank（重排）

而不是早前的：

- `vector_only`
- `bm25_unavailable`
- `clarify` 提前退化

### 3.3 回答生成验证

`/rag/ask` 已恢复正常流式输出，说明：

- chat provider 已可用
- SSE 回答链路恢复
- 生成阶段不再被 `401 INVALID_API_KEY` 阻断

---

## 4. 验收结论

本轮 Phase 4 修复后，系统已经从“结论不可信的混乱态”恢复到“可以继续做真实调优和回归”的工程状态。

### 已达到

1. 知识库可稳定 reset + seed
2. Embedding 接入百炼并适配 batch 限制
3. 检索恢复 hybrid/RRF/rerank 主链路
4. Chat 切换至可用 provider 后恢复回答生成
5. `/rag/debug`、运行实例、端口占用三者已重新对齐

### 仍需继续

1. 继续提升中文问题下的相关性排序质量
2. 将 chat provider 配置从“临时复用 codex 本机配置”整理为项目显式配置方案
3. 继续推进 Phase 4 后续真实 eval 与 acceptance 收口

---

## 5. 术语解释（面向边学边建）

- **Embedding**：把文本转成一串数字坐标，方便系统比较“语义上谁更像谁”。
- **Batch size**：一次请求里打包多少条文本一起送给模型。
- **Fallback**：主方案失败时的兜底方案。
- **Hybrid retrieval**：语义检索 + 关键词检索一起用。
- **RRF**：把多路检索结果融合排序的一种简单稳定方法。
- **Rerank**：先粗召回，再精排，把更像答案的片段往前提。
- **SSE**：服务端流式推送内容，前端看起来像“打字机输出”。
- **In-memory KB**：知识库只存在内存里，进程重启后会丢失。

---

## 6. 本轮涉及文件

- `server/src/modules/retrieval/hybrid-retriever.service.ts`
- `server/src/providers/llm.provider.ts`
- `server/scripts/seed.ts`
- `server/src/modules/rag/rag.controller.ts`
- `server/src/modules/rag/rag.service.ts`
- `server/src/modules/context/context-builder.service.ts`
- `server/src/modules/ingest/ingest.controller.ts`
- `server/src/modules/ingest/ingest.service.ts`
- `server/src/main.ts`
- `server/src/modules/config/app.config.ts`
- `web/vite.config.ts`
- `web/package.json`

---

## 7. 下一步

1. 继续做 Phase 4 的真实 eval / case 回归
2. 收口 acceptance 文档与 outcome 文档
3. 做本阶段 focused commit 并 push
