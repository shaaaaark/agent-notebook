# Phase 4 Rerank Runtime Note

## 结论

在当前运行环境中，本地 reranker（`@xenova/transformers` + `Xenova/bge-reranker-base`）不是主推路径。

原因不是模型逻辑错误，而是运行时会在首次加载时访问 Hugging Face 远程资源；当前网络下该请求超时，表现为：

- `fetch failed`
- `ETIMEDOUT`
- 远程地址不可达

因此：

- `RERANK_PROVIDER=local` 时，Phase 4 检索链路会稳定降级
- `RERANK_PROVIDER=bailian` 时，当前环境可恢复 `hybrid_rrf_rerank`

## 验证结果

在本地最小样本知识库上验证：

- `RERANK_PROVIDER=local`
  - `strategy=hybrid_rrf`
  - `degraded=true`
  - `rerank_provider=local`
  - `rerank_skipped=true`
- `RERANK_PROVIDER=bailian`
  - `strategy=hybrid_rrf_rerank`
  - `degraded=false`
  - `rerank_provider=bailian`
  - `rerank_skipped=false`

## 当前建议

1. 默认配置使用 Bailian rerank
2. 本地 rerank 仅作为离线或已预热模型缓存环境下的备用路径
3. 后续若要恢复 local 默认路线，需要先解决模型拉取与缓存预热问题
