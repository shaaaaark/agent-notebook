# Phase 5 Outcome

## 阶段结论
Phase 5 已完成第一轮工程化骨架落地：策略配置、评估门禁、trace 策略版本、最小 replay 能力已具备。

## 产出文件
- `server/config/policy.yaml`
- `server/eval/thresholds.yaml`
- `server/eval/replay.ts`
- `PHASE5_PLAN.md`
- `PHASE5_ACCEPTANCE.md`

## 代码改动
- `server/src/modules/config/app.config.ts`
- `server/src/modules/trace/trace.service.ts`
- `server/src/modules/rag/rag.service.ts`
- `server/eval/harness.ts`

## 节点补充：运行时参数真实接线
- `policy.yaml -> app.config -> runtime` 现已继续向下打通到 `context-builder`、`rag.service`、`llm.provider`
- `context.min_selected_chunks` 控制 context 低相关性裁剪前的最小保留 chunk 数
- `retrieve.lexical_signal.min_bm25_score`、`retrieve.lexical_signal.min_bm25_hits`、`retrieve.lexical_signal.min_rrf_score` 控制 BM25 lexical signal 是否参与 hybrid fusion 与低信号 guardrail
- `context.max_context_tokens` 作为新的语义化配置名进入 runtime，`context.token_budget` 仍只保留为 budget 语义别名
- `context.min_incremental_coverage` 作为低相关过滤阈值配置名进入 runtime
- `generation.answer_strategy`、`generation.require_citations`、`generation.max_evidence_points` 控制回答 prompt 策略
- `generation.clarify_message_template`、`generation.abstain_message_template` 控制低置信 fallback 话术
- `generation.temperature` 已真实进入 LLM completion / stream payload
- `guardrails.weak_signal_*` 控制低置信判定
- `guardrails.sensitive_patterns[]` + `guardrails.risk_intents[]` + `guardrails.enforcement_mode` 已作为高风险 query 规则 v1，支持 `keyword` / `regex` / `phrase` 与 `clarify` / `abstain` / `allow_with_warning`

## 本节点新增：Runtime Policy Wiring
- retrieval policy 命名已固定为 `lexical_signal.min_bm25_score / min_bm25_hits / min_rrf_score`
- context policy 命名已固定为 `min_incremental_coverage`
- 高风险 query 识别已改为轻量 rule engine：按命中规则累计风险分，再结合 `enforcement_mode` 输出 low / medium / high 三档动作
- config/context/retrieval/rag 四类 spec 已补齐，覆盖 retrieval 边界、最终字段名与 low / medium / high risk action

## Policy 可调 vs 代码常量
### 当前可调（policy）
- retrieval：`top_k*`、`fused_top_n`、`rerank_top_m`、`rrf_k`、`min_score_threshold`、`lexical_signal.*`
- context：`max_context_tokens`、`max_chunks_per_source`、`min_selected_chunks`、`min_incremental_coverage`
- generation：`model`、`max_tokens`、`temperature`、`answer_strategy`、`require_citations`、`max_evidence_points`、clarify/abstain template
- guardrails：`abstain_threshold`、各类 timeout、`enforcement_mode`、`sensitive_patterns[]`、`risk_intents[]`、`weak_signal_*`

### 仍为代码常量
- `allow_with_warning` 的 warning 前缀文案
- query risk 累计分档阈值（轻量 v1）
- context token 估算启发式
以前这套系统更像“手工调参 + 手工看结果”。
现在开始具备下面四种工程能力：
1. 策略有版本号
2. 评估结果有 gate verdict
3. 单个请求可以最小回放
4. `policy.yaml` 已能真实覆盖关键运行参数，而不是摆设配置

## 本节点新增：Runtime Policy Wiring
- `policy.yaml` 新增并接入 `context.min_selected_chunks`
- `policy.yaml` 新增并接入 `context.max_context_tokens`
- `policy.yaml` 新增并接入 `context.min_incremental_coverage`
- `policy.yaml` 新增并接入 `generation.answer_strategy`
- `policy.yaml` 新增并接入 `generation.require_citations`
- `policy.yaml` 新增并接入 `generation.max_evidence_points`
- `generation.temperature` 现已真正传入 LLM runtime 请求，而不只是停留在配置层
- `retrieve.min_score_threshold` 现用于回答前的检索信号判定，和 `guardrails.abstain_threshold` 分开承担“可答”与“高风险拒答”两层阈值
- `retrieve.lexical_signal.*` 现已驱动 retrieval 阶段 lexical signal 参与条件与低信号判定，不再保留本地硬编码
- 高风险 query 判断由 `guardrails.sensitive_patterns[]` + `guardrails.risk_intents[]` 驱动；`allow_with_warning` 会在成功回答前附加 warning 前缀
- `ContextBuilderService` 的低相关过滤门槛不再固定写死，`min_selected_chunks` 与 `min_incremental_coverage` 共同控制上下文入选策略

## 下一阶段建议
继续清理仍未参数化的少量局部策略，例如 `allow_with_warning` 的独立模板配置、query risk rule 的优先级/分组控制，以及 replay 对完整 prompt/strategy 的确定性复现。

## baseline 对比门禁新增（本轮已验证）
- `server/eval/thresholds.yaml` 新增 `baseline_delta.hard_regressions` 和 `baseline_delta.soft_regressions`
- `eval/harness.ts --compare` 现同时执行 candidate floor 与 baseline delta 判定
- compare 报告新增 `Gate Verdict`、`Baseline hard regressions`、`Baseline soft regressions`、`Baseline improvements`
- 本地 smoke 验证使用 `_baseline_smoke` 对比 `_candidate_smoke`，结果为 `FAIL`
- 本地 smoke 门禁命中：hard failures=`recall_at_k, context_hit`，manual review=`clarify_rate`，baseline hard regressions=`recall_at_k, context_hit`，baseline soft regressions=`clarify_rate`
