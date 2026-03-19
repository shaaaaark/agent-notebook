# Next Step Plan

> 用途：只记录当前一小段时间内最该做的事，避免和 `docs/execution/EXECUTION_PLAN.md` 重复叙事。

## 当前结论

系统已经从“运行态不可信”恢复到“可以继续验证与调优”的状态，但 **Phase 4 仍未正式通过验收**。

已确认：
- KB 可 reset + reseed
- 检索主链路可恢复到 `hybrid_rrf_rerank`
- `/rag/ask` 已恢复 SSE 流式输出
- `/rag/retrieve` 可返回策略与降级调试字段

未确认完毕：
- 中文问题下的相关性排序质量是否稳定
- clarify / abstain 是否仍偏保守
- rerank 不可用时的降级语义是否足够清晰
- Phase 4 指标是否达到正式验收要求

## 当前下一步

### 1. 收口回答保守问题
- 检查 `RagService` 中 clarify / abstain 的触发条件
- 避免“已有证据但过早拒答”
- 让生成链路先尽量基于已有证据总结，再决定是否需要补充限定

### 2. 优化上下文拼装
- 检查 `ContextBuilderService`
- 降低泛泛 chunk 抢预算的概率
- 提高真正命中问题根因的 chunk 进入最终 context 的概率

### 3. 明确 rerank provider 策略
- 当前环境下本地 `@xenova/transformers` reranker 会因拉取 Hugging Face 模型超时而失败
- 默认应优先使用 Bailian rerank；本地 rerank 作为离线兜底而不是默认主路径
- rerank 不可用时，输出清晰的 `degraded / degrade_reason`
- 避免静默影响回归结论

### 4. 重跑正式 eval
- 跑 30-case eval
- 对比 Phase 3 基线
- 记录 Recall@K / Context-hit / clarify rate

## 完成标准

满足以下条件后，可把当前工作从“恢复运行态”推进到“Phase 4 正式验收收口”：

1. 30 个 eval cases 能稳定跑完
2. 不再出现大面积无意义 `clarify`
3. 检索与生成结果逻辑一致
4. degraded 信息可解释
5. 验收与成果文档同步更新：
   - `docs/acceptance/PHASE4_ACCEPTANCE.md`
   - `docs/phases/PHASE4_OUTCOME.md`

## 已知风险

1. chat provider 目前可能仍带有临时性配置特征，需要后续整理成项目显式配置方案
2. 知识库仍是内存型，重启后会丢失
3. 本地 rerank 模型可用性仍可能影响回归稳定性

## 后续入口

当 Phase 4 正式收口后，再进入：
- Phase 5：policy / thresholds / replay
