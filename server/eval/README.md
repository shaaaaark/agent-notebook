# Eval 体系说明

## 目录结构

```
eval/
  cases/                    ← Eval Case JSON 文件
    rag-retrieval.json      ← 检索质量相关（4 cases）
    context-eval.json       ← Context Builder 相关（3 cases）
    observability-eval.json ← 可观测 / Trace / 护栏（4 cases）
    release-eval.json       ← 发布工程 / 灰度 / Replay（4 cases）
    eval-system.json        ← 评估体系自身 / Agent（5 cases）
  runs/                     ← 每次回归的运行结果（自动生成，gitignore）
    {run_id}/
      trace.jsonl           ← 每个 case 的完整 trace
      metrics.json          ← Recall@K、Context-hit、citation_correct_rate
      report.md             ← 对比上一次运行的差异报告
  harness.ts                ← 回归脚本（待实现，见 ROADMAP Phase 3）
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
| `rag-retrieval.json` | 4 | `2026-03-11`, `2026-03-13_1651` |
| `context-eval.json` | 3 | `2026-03-13_1843`, `2026-03-13_1729` |
| `observability-eval.json` | 4 | `2026-03-13_1610`, `2026-03-14_1045/1151/1230` |
| `release-eval.json` | 4 | `2026-03-14_1010`, `2026-03-16_1202/1236/1309` |
| `eval-system.json` | 5 | `2026-03-12`, `2026-03-13_1920/1955/2030/1531` |
| **合计** | **20** | — |

## 使用流程

### 1. 导入测试数据（首次）

```bash
# 在 server/ 目录下运行
npx ts-node scripts/seed.ts
# 将 md-collection/ai_progress/ 22 篇笔记全部导入知识库
```

### 2. 运行回归（ROADMAP Phase 3 实现后）

```bash
npx ts-node eval/harness.ts --run-id baseline_$(date +%Y%m%d)
```

### 3. 对比两次运行

```bash
npx ts-node eval/harness.ts --compare baseline_20260316 baseline_20260323
```

### 4. 手动验证指标基线

在 harness.ts 实现前，可以手动验证：
1. 启动后端，运行 `seed.ts` 导入所有笔记
2. 逐条将 `question` 发给 `/rag/ask`
3. 检查响应中 `sources` 是否包含 `gold_sources` 中的文件（Recall@K）
4. 检查答案是否覆盖 `expected_points` 中的关键点

## 指标定义

| 指标 | 公式 | 目标值 |
|---|---|---|
| `Recall@K` | gold_source 出现在 topK 中的 case 比例 | ≥ 0.8（Phase 4 目标） |
| `Context-hit` | gold_source 进入最终 context 的 case 比例 | ≥ 0.75 |
| `citation_correct_rate` | 有效引用论点数 / 总论点数 | ≥ 0.85 |
| `abstain_rate` | clarify/abstain 的请求占比 | < 0.10 |
