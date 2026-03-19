# Phase 5 Acceptance

## 本阶段目标
把当前 RAG 系统推进到可配置、可门禁、可最小回放的工程阶段。

## 本次完成项
- [x] 新增 `server/config/policy.yaml`
- [x] 新增 `server/eval/thresholds.yaml`
- [x] `RequestTrace` 增加 `policy_version`
- [x] `RequestTrace` 增加 `replay_input`
- [x] `eval/harness.ts --compare` 输出 gate verdict
- [x] 新增 `eval/replay.ts` 最小回放脚本
- [x] `policy.yaml` 已接入 config 读取链路并覆盖关键 retrieval/context/generation/guardrails 参数

## 验收标准
- 策略版本号可在 trace 中看到
- compare 报告带 `PASS / MANUAL_REVIEW / FAIL`
- 给定 `request_id` 可重放同一 query
- compare gate 同时检查 candidate floor 和 baseline delta

## 本轮 compare gate 规则（节点 1 定稿）
### 1. Verdict 分级
- `PASS`：candidate 满足全部 hard gates，且相对 baseline 没有出现超出容差的明显退化
- `MANUAL_REVIEW`：candidate 未触发 hard fail，但触发了 soft gate 或出现轻度回退，需要人工判断是否放行
- `FAIL`：candidate 触发 hard gate 失败，或相对 baseline 出现超出允许范围的关键指标退化

### 2. 判定维度
#### candidate floor（绝对门槛）
- 继续沿用 `server/eval/thresholds.yaml` 中的 hard/soft gates
- hard gates 决定是否直接 fail
- soft gates 决定是否进入 manual review

#### baseline delta（相对回退）
- compare 模式下，除检查 candidate 自身达线外，还要比较 candidate 与 baseline 的指标差异
- 关键质量指标若低于 baseline 超过容差，升级为 `FAIL`
- 次要体验指标若低于 baseline 超过容差，升级为 `MANUAL_REVIEW`

### 3. 结果输出结构
- 输出最终 `verdict`
- 输出 `Hard failures`
- 输出 `Manual review`
- 输出 `Baseline hard regressions`
- 输出 `Baseline soft regressions`
- 输出 `Baseline improvements`

### 4. 本轮默认规则
- 召回/引用/上下文命中/错误率属于关键指标，显著回退直接 fail
- 澄清率/弃答率属于次要指标，轻度回退进入 manual review
- 如果 baseline 不存在，则只基于 candidate floor 给出 verdict

## 本地验证（baseline compare gate）
- 执行 `cd server && npm run build`
- 执行 `cd server && npx ts-node eval/harness.ts --compare _baseline_smoke _candidate_smoke`
- smoke compare 输出 `FAIL`
- candidate hard failures：`recall_at_k`、`context_hit`
- candidate manual review：`clarify_rate`
- baseline hard regressions：`recall_at_k`、`context_hit`
- baseline soft regressions：`clarify_rate`

## 已知限制
- `policy.yaml` 目前已落地为配置文件，但业务参数尚未全部改为从 YAML 热读取
- replay 目前重放的是 query 级别，不是全量 deterministic replay
- baseline delta 仅在 `eval/harness.ts --compare` 模式参与门禁；单次 run 仍只生成 candidate metrics
