# Phase 4 修复成果文档（真实运行态收口）

## 1. 阶段目标

本阶段的核心不是继续扩能力，而是把 `agent-notebook` 从“看起来有功能，但运行结论不可信”的状态，拉回到一个**能真实验证、能稳定复现、能继续调优**的工程状态。

本轮重点解决了三类问题：

- Embedding 批量接入不兼容
- Chat provider 认证失败
- 运行态被旧实例污染

## 2. 本轮新增修复

### 2.1 百炼 Embedding 批量分片

接入 Alibaba Bailian `text-embedding-v3` 后，发现接口存在明确约束：

- 单次 embedding 请求最多 10 条输入

原实现直接把整批 chunk 一次提交，导致较长文档在导入时触发：

- `batch size is invalid`
- fallback 到本地向量化

这会污染检索质量，也会让 Phase 4 的验证结果失真。

因此本轮在 `HybridRetrieverService.embedTexts()` 中增加了**分批发送策略**：

- 每批最多 10 条
- 多批结果拼接为完整向量结果

这样做的价值，不是“让接口勉强可用”，而是让 embedding 质量重新可控。

### 2.2 试验 text-embedding-v4 后回退

为验证是否能通过升级模型规避限制，本轮曾试验 `text-embedding-v4`。

结果：

- 健康检查可通过
- 但未解决当前批量约束问题

因此最终决策不是盲目升级，而是：

> 保持 `text-embedding-v3`，修正调用策略。

这体现的是工程取舍：优先解决根因，而不是用换型号掩盖问题。

### 2.3 Chat 切换为可用 gpt-5.4 provider

原 chat provider 在 `/rag/ask` 阶段返回 `401 INVALID_API_KEY`，导致系统虽然能检索，但不能基于证据生成回答。

本轮通过用户现有 codex 可用配置完成临时接入验证：

- `OPENAI_BASE_URL=http://172.27.0.1:8080/v1`
- `OPENAI_MODEL=gpt-5.4`

Embedding 与 Chat 继续分离：

- Chat：走 codex 已验证可用的 provider
- Embedding：继续走百炼 compatible endpoint

结果：

- `/rag/debug` 可见 chat model 为 `gpt-5.4`
- `/rag/ask` 恢复流式回答

### 2.4 清理运行态污染

本轮还确认了一个非常危险的现实问题：

- 9527 端口上可能残留旧实例
- 这会导致“配置改了，但真正服务请求的还是旧进程”

因此本轮采用了更明确的运行态收敛方式：

- 清理旧 pid
- 只保留单一 `dist/src/main` 进程
- 重启后立刻用 `/rag/debug` 校验真实生效配置
- 重新 seed 内存知识库

这一步的意义很大：

> 它保证后续你看到的日志、接口、行为，来自同一份代码和同一个实例，而不是混杂结果。

## 3. 验证结果

### 3.1 知识库

重新 reset + seed 后，当前状态为：

- 22 documents
- 126 chunks

### 3.2 检索链路

对问题：

> `RAG生产环境中召回不足的根本原因是什么？`

当前 `/rag/retrieve` 已恢复为：

- `strategy = hybrid_rrf_rerank`
- `degraded = false`

说明系统不再停留在：

- `vector_only`
- `bm25_unavailable`
- 早期 clarify 退化

而是恢复到了完整混合检索路径。

### 3.3 生成链路

`/rag/ask` 已恢复正常 SSE 输出，说明：

- chat provider 可用
- 认证链路打通
- 前端流式回答体验恢复

## 4. 工程价值

这一轮修复的价值，不在于“多做了几个接口”，而在于恢复了几个最重要的工程前提：

1. **运行态可信**：不是改了代码却跑着旧实例
2. **数据面可信**：知识库确实按当前语料重建
3. **检索链路可信**：不是大面积 fallback 或误退化
4. **生成链路可信**：不是检索成功但回答阶段被 provider 卡死

换句话说，本轮之后，`agent-notebook` 才重新回到了一个值得继续调参与验收的状态。

## 5. 术语解释

- **Provider**：模型服务提供方或网关
- **认证失败 401**：请求到了，但服务端不认可当前 key
- **流式回答**：答案不是一次性吐完，而是边生成边返回
- **运行态污染**：你以为在测新代码，其实请求落在旧进程上
- **知识库重建**：把已有文档重新切片、向量化、建索引

## 6. 后续动作

下一步应继续：

1. 跑更真实的 eval case 回归
2. 调整中文场景下的相关性排序
3. 把 chat provider 从“临时复用本机 codex 配置”沉淀为项目自己的正式配置方式
4. 完成本阶段 focused commit 与推送
