# Eval 体系说明

## 目录结构

```
eval/
  cases/                    ← Eval Case JSON 文件
    rag-retrieval.json      ← 检索质量相关（6 cases）
    context-eval.json       ← Context Builder 相关（5 cases）
    observability-eval.json ← 可观测 / Trace / 护栏（6 cases）
    release-eval.json       ← 发布工程 / 灰度 / Replay（6 cases）
    eval-system.json        ← 评估体系自身 / Agent（7 cases）
  runs/                     ← 每次回归的运行结果（自动生成，gitignore）
    {run_id}/
      trace.jsonl           ← 每个 case 的运行记录
      metrics.json          ← Recall@K、Context-hit、citation_presence_rate
      report.md             ← 单次回归摘要与失败 case
      compare_to_{run}.md   ← 与基线 run 的差异报告
  inbox/                    ← 从 trace 归集出的待人工标注草稿（自动生成，gitignore）
  harness.ts                ← 回归脚本（run + compare）
  collect-failures.ts       ← 从 trace 中抽取失败样本
  thresholds.yaml           ← Hard Gate / Soft Gate 阈值（待实现，见 ROADMAP Phase 5）
  README.md                 ← 本文件
```

## Case 格式说明

```typescript
interface EvalCase {
  case_id: string           // 唯一 ID，如 "rag-001"
  category: string          // 分类标签
  question: string          // 提问内容（直接发给 /rag/ask）
  expected_points: string[] // 期望答案覆盖的关键点（人工标注）
  must_cite: boolean        // 是否要求有引用标注 [E1] 等
  gold_sources: string[]    // 期望召回的文件名（用于 Recall@K 评估）
  constraints: string[]     // 额外约束（如"必须区分两种方式"）
}
```

## 当前 Case 统计

| 文件 | Cases 数 | 对应笔记 |
|---|---|---|
| `rag-retrieval.json` | 6 | `2026-03-11`, `2026-03-13_1651` |
| `context-eval.json` | 5 | `2026-03-13_1843`, `2026-03-13_1729` |
| `observability-eval.json` | 6 | `2026-03-13_1610`, `2026-03-14_1045/1151/1230` |
| `release-eval.json` | 6 | `2026-03-14_1010`, `2026-03-16_1202/1236/1309` |
| `eval-system.json` | 7 | `2026-03-12`, `2026-03-13_1920/1955/2030/1531` |
| **合计** | **30** | — |

## 使用流程

### 1. 导入测试数据（首次）

```bash
# 在 server/ 目录下运行
npx ts-node scripts/seed.ts
# 将 md-collection/ai_progress/ 22 篇笔记全部导入知识库
```

### 2. 运行回归

```bash
npx ts-node eval/harness.ts --run-id baseline_$(date +%Y%m%d)
```

### 3. 对比两次运行

```bash
npx ts-node eval/harness.ts --compare baseline_20260316 baseline_20260323
```

对比结果会写入 `eval/runs/baseline_20260323/compare_to_baseline_20260316.md`。
现在 compare 报告会额外给出 gate verdict：`PASS / MANUAL_REVIEW / FAIL`。

### 4. 回放单个请求（Phase 5 MVP）

```bash
npx ts-node eval/replay.ts --request-id <request_id> --host http://127.0.0.1:9527
```

用途：根据历史 trace 中保存的 `replay_input.query` 重新触发一次 `/rag/ask`，用于快速复现线上或回归中的单点问题。

### 5. 归集失败案例草稿

```bash
npx ts-node eval/collect-failures.ts --days 7
```

输出文件默认写入 `eval/inbox/`，用于人工补充 `expected_points` 和 `gold_sources` 后再转入 `eval/cases/`。

### 5. 手动 spot check

1. 启动后端，运行 `seed.ts` 导入所有笔记
2. 逐条将 `question` 发给 `/rag/ask`
3. 检查响应中 `sources` 是否包含 `gold_sources` 中的文件（Recall@K）
4. 检查答案是否覆盖 `expected_points` 中的关键点

## 指标定义

| 指标 | 公式 | 目标值 |
|---|---|---|
| `Recall@K` | gold_source 出现在 topK 中的 case 比例 | ≥ 0.8（Phase 4 目标） |
| `Context-hit` | gold_source 进入最终 context 的 case 比例 | ≥ 0.75 |
| `citation_presence_rate` | 要求引用的 case 中，答案出现 `[E1]` 等引用的比例 | Phase 3 MVP |
| `abstain_rate` | clarify/abstain 的请求占比 | < 0.10 |

## Phase 3 边界

- 当前 Phase 3 已完成回归运行、结果汇总、run 间对比、失败案例归集。
- `thresholds.yaml`、自动 hard gate、灰度发布、replay 仍属于 Phase 5，不在本阶段实现范围内。
