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

## 已知限制
- `policy.yaml` 目前已落地为配置文件，但业务参数尚未全部改为从 YAML 热读取
- replay 目前重放的是 query 级别，不是全量 deterministic replay
- gate 目前只基于 candidate metrics，不带 baseline delta 门槛
