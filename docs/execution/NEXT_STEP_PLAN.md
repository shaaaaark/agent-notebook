# Next Step Plan

> 用途：只记录当前一小段时间内最该做的事，避免和 `docs/execution/EXECUTION_PLAN.md` 重复叙事。

## 当前结论

系统已经从“运行态不可信”恢复到“可以继续验证与调优”的状态，但当前首先暴露出的前置阻塞不是检索策略，而是：**知识库仍是内存型，重启与实例切换会直接破坏开发、评测和回放稳定性。**

因此，当前优先级已调整为：**先做 P0 最小持久化，再继续 Phase 4 收口。**

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

### 1. 先完成 P0：知识库最小持久化 / 向量落库
- 让文档、chunk、向量在重启后可恢复
- 消除“换实例 / 重启后空库”的开发阻塞
- 确保 `ingest/status`、`reindex`、seed 与 eval 基于稳定知识库工作

### 2. 在稳定知识库状态上恢复真实 eval
- 使用真实知识库重新跑 30-case eval
- 保留 run 产物，和已有 Phase 3 / Phase 4 run 做 compare
- 重点看 `Recall@K / Context-hit / clarify_rate / degraded 分布`

### 3. 定点排查“有证据却 clarify”的 case
- 逐个看 retrieval topK 是否已经命中 gold source
- 检查 `ContextBuilderService` 是否误杀高价值 chunk
- 检查 `RagService` 是否在已有证据时仍过早进入 clarify / abstain

### 4. Phase 4 收口后再推进 Phase 5
- 当前不再扩散到新能力点
- 等 Phase 4 的真实回归与质量判断收稳后，再继续 policy / gate / replay

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
3. 若手动切回 local rerank，本地模型拉取仍可能影响回归稳定性

## 后续入口

当 Phase 4 正式收口后，再进入：
- Phase 5：policy / thresholds / replay
