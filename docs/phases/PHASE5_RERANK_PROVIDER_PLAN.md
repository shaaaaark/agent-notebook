# Phase 5 Next Node — qwen3-vl-rerank 接入评估与实施计划

更新时间：2026-03-19
状态：规划中，尚未开始接入代码

## 1. 结论

下一节点不直接替换现有本地 reranker，而是先做 **可切换 rerank provider 架构**：

- 保留当前本地 `@xenova/transformers` reranker 作为默认/兜底
- 新增 Bailian `qwen3-vl-rerank` provider
- 通过 `policy.yaml + env` 控制 provider 选择
- 任一 provider 超时/失败时，统一降级到 `hybrid_rrf`

这样能满足 roadmap 的“参数化发布 + 可回滚”，也避免把外部模型接入直接耦死在检索主链路里。

## 2. 为什么先做 provider 抽象

当前问题：
- `HybridRetrieverService` 直接依赖 `LocalRerankerService`
- rerank 模型名虽然可配，但实现仍是本地 transformers 专用
- 如果直接把 Bailian 调用塞进 `LocalRerankerService`，会把“本地模型”和“远端 API”两类失败模式混在一起

先抽象的收益：
- 明确 provider 边界：`local | bailian`
- 降级和 trace 口径统一
- 后续 A/B、灰度、回放都能复用同一运行时接口

## 3. 目标

把 rerank 层从“单一本地实现”升级为“可配置 provider”。

### 本节点验收标准

1. `policy.yaml` 可配置 rerank provider
2. retrieval 主链路不再直接依赖 `LocalRerankerService`
3. 默认行为与当前一致（未开 Bailian 时不回归）
4. provider 超时/失败时，仍按现有策略降级到 `hybrid_rrf`
5. 至少覆盖：config spec、retrieval spec、provider 级单测
6. backend build 通过

## 4. 计划中的配置面

建议新增：

```yaml
retrieve:
  rerank_provider: local   # local | bailian
  rerank_model: Xenova/bge-reranker-base

bailian:
  rerank_base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
  rerank_api_key: ${BAILIAN_API_KEY}
  rerank_model: qwen3-vl-rerank
```

兼容原则：
- `retrieve.rerank_provider` 默认 `local`
- `retrieve.rerank_model` 继续保留，供 local provider 使用
- Bailian 独立命名空间，避免和 chat/embedding 混淆
- 如无独立 `rerank_api_key`，可回退到通用 Bailian/OpenAI key，但文档里要明确优先级

## 5. 代码改动范围

### 5.1 retrieval 层
- 新增 `Reranker` 接口（统一 `rerank()` 返回结构）
- `LocalRerankerService` 改为 provider 之一
- 新增 `BailianRerankerService`
- 新增 `RerankerService` / `RerankerRouterService` 负责按配置选择 provider
- `HybridRetrieverService` 改依赖统一 reranker 接口

### 5.2 config 层
- `policy.yaml` 增加 provider 字段
- `app.config.ts` 增加：
  - `retrieve.rerankProvider`
  - `retrieve.rerankModel`
  - `bailian.rerankBaseUrl`
  - `bailian.rerankApiKey`
  - `bailian.rerankModel`
- spec 覆盖默认值、yaml 读取、env 覆盖优先级

### 5.3 trace / 调试口径
建议补充但可分两步：
- 记录 `rerank_provider`
- 记录 `rerank_skipped_reason`
- 记录 `rerank_latency_ms`

这部分如果牵动面太大，可先只在 retrieval 结果中保留内部字段，trace 下一节点补齐。

## 6. Bailian provider 设计

目标不是追求一次做全，而是先做最小稳定集成。

### 输入
- query: string
- chunks: RetrievedChunk[]
- limit: number

### 输出
- chunks: RetrievedChunk[]（附 `rerankScore`）
- skipped: boolean
- reason?: string
- latencyMs: number

### 失败处理
以下情况统一视为 `skipped=true`：
- API key 缺失
- HTTP 超时
- 非 2xx
- 返回结构不可解析
- score 数量与输入不一致

### 排序原则
- 仅重排 `limit` 范围内候选
- 用远端 score 写入 `rerankScore`
- 最终排序仍由统一 reranker 输出负责，`HybridRetrieverService` 不关心 provider 细节

## 7. 风险与取舍

### 风险 1：qwen3-vl-rerank 接口格式不确定
处理：
- 先按兼容 OpenAI 风格/HTTP JSON 封装
- 接入前用真实请求做一次最小探针验证
- 如果接口与预期差异大，先保留 provider 骨架和 fail-fast，不阻塞主线

### 风险 2：远端时延高于本地
处理：
- 继续复用 `guardrails.rerankTimeoutMs`
- 超时直接降级，不放大尾延迟
- 默认 provider 仍设为 `local`

### 风险 3：线上 key/endpoint 配置混乱
处理：
- Bailian rerank 配置单列命名空间
- 文档明确优先级与最小必填项
- 无 key 时打印一次 warn，不在每次请求刷屏

## 8. 实施顺序

### Stage A：抽象层落地
- 提炼 rerank interface/types
- 引入 router service
- 不改行为，只让 local provider 走新接口

### Stage B：Bailian provider 接入
- 增加配置读取
- 增加 HTTP 调用与超时处理
- 增加 provider 级单测（mock fetch）

### Stage C：回归验证
- retrieval spec 补 provider 切换/失败降级
- build + 定向测试
- 如有真实 key，再做一次 smoke 验证

## 9. 当前下一步

先做 Stage A：**抽象 rerank provider 接口并把现有 local reranker 挂到统一路由下**。

这是最小且必要的依赖步骤；不先做这个，后面 Bailian 接入会继续污染主链路。
