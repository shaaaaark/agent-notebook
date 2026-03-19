# Next Step Plan — Post Phase 4 Runtime Recovery

> 更新时间：2026-03-18
> 当前状态：检索链路、embedding 接入、chat 生成链路已恢复可运行；下一步进入 **Phase 4 正式验收收口 + Phase 5 规划准备**。

## 1. 当前结论

当前系统已经从“运行态不可信”恢复为“可继续验证与调优”的状态：

- KB 可 reset + reseed
- Embedding 已切到 Bailian，并适配单次最多 10 条的 batch 限制
- `/rag/retrieve` 已恢复 `hybrid_rrf_rerank`
- `/rag/ask` 已恢复 SSE 流式输出
- Chat model 固定为 `gpt-5.4`

但还没有完成真正的 Phase 4 正式验收，因为“能跑”不等于“效果达标”。

---

## 2. 下一阶段目标

### Stage B — Phase 4 正式验收：混合检索 + 重排

目标是把当前“已经恢复”的链路，推进到“效果可量化验收”的状态。

### 2.1 核心任务

1. **回答保守问题收敛**
   - 检查 `RagService` 中 clarify / abstain 的触发条件
   - 放宽“证据不足”判断，避免检索有结果却过早拒答
   - 优化 prompt，让模型先基于现有证据总结，再决定是否补充限定

2. **上下文拼装优化**
   - 调整 `ContextBuilderService`
   - 避免高分但泛泛而谈的 chunk 抢占上下文预算
   - 提高“直击问题根因”的证据进入最终 context 的概率

3. **中文相关性调优**
   - 继续验证 mixed Chinese/English tokenization 是否稳
   - 检查 BM25 命中分布与 rerank 前后排序变化
   - 必要时增加 query expansion 或术语归一化

4. **rerank 降级策略明确化**
   - 当前本地 reranker 仍可能受模型可用性影响
   - 需要把“rerank 不可用”定义为可解释降级，而不是静默影响结果
   - 输出更明确的 `degraded / degrade_reason`

5. **Eval 正式回归**
   - 重跑 30-case eval
   - 对比 Phase 3 基线
   - 记录 Recall@K / context-hit / clarify rate

---

## 3. 验收指标

### Phase 4 正式通过前至少满足：

1. 30 个 eval cases 能稳定跑完
2. 不再出现大面积无意义 `clarify`
3. 检索结果与生成结果逻辑一致
4. 有清晰的 degraded 说明
5. 产出文档：
   - `PHASE4_ACCEPTANCE.md`
   - `docs/phases/PHASE4_OUTCOME.md`

---

## 4. 技术风险

1. **当前 chat 仍临时依赖本机 codex 配置**
   - 短期能跑
   - 长期不适合作为正式项目配置方案

2. **知识库仍是内存型**
   - 重启即丢
   - 会影响大规模回归和长期验证效率

3. **rerank 模型可用性仍不完全稳定**
   - 需要决定：是继续修本地 reranker，还是明确接受降级策略

---

## 5. 建议执行顺序

### 先做
1. 调 `RagService` 的回答保守问题
2. 调 `ContextBuilderService` 的上下文选片策略
3. 补 rerank 降级语义

### 再做
4. 跑正式 eval
5. 写 Phase 4 正式验收文档
6. 做 focused commit + push

### 然后进入
7. 开始 Phase 5：policy / thresholds / replay 的设计与实现

---

## 6. 术语解释

- **clarify**：系统不直接回答，而是让用户补充问题或资料。
- **abstain**：系统主动放弃给确定答案，避免胡说。
- **context budget**：上下文预算，也就是模型这次回答最多能塞多少证据文本。
- **query expansion**：把用户原问题扩成更多近义表达，提升召回概率。
- **degraded**：系统没完全按理想链路运行，而是发生了可控降级。
