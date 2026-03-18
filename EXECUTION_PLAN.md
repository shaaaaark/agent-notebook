# Agent Notebook — Execution Plan (Reordered)

> 目标：保持 `ROADMAP.md` 作为产品主线不变，但按“先修会污染后续阶段结果的基础问题，再推进能力增强”的原则重排实施顺序。
>
> 执行要求：**每个阶段都必须产出代码、验收标准、阶段成果文档，并在通过验收后提交 `commit` + `push`。**

---

## 执行总原则

1. **主线不变**：仍然按 ROADMAP 的 Phase 1 → 7 目标推进。
2. **顺序重排**：优先处理会影响后续所有评估与调试结论的基础问题。
3. **阶段闭环**：每个阶段必须包含：
   - 任务范围
   - 验收标准
   - 实施记录
   - 已知限制
   - 下一阶段建议
4. **提交纪律**：
   - 每完成一个阶段，至少 1 个聚焦 commit
   - 验收通过后 push 到 `origin/main`
5. **文档纪律**：
   - 产品主线：`ROADMAP.md`
   - 执行主线：`EXECUTION_PLAN.md`
   - 阶段验收：`PHASE{N}_ACCEPTANCE.md`
   - 阶段成果：`docs/phases/PHASE{N}_OUTCOME.md`

---

## 当前阶段评估（基于 2026-03-18 代码现状）

| 阶段 | 路线目标 | 代码状态 | 验收状态 | 结论 |
|---|---|---:|---:|---|
| Phase 1 | MVP 闭环 | 已实现 | 已通过 | 保留结果，补执行基线文档 |
| Phase 2 | Context + Trace | 已实现 | 已通过 | 保留结果 |
| Phase 3 | Eval 体系 | 已实现第一版 | 已通过 | 保留结果 |
| Phase 4 | Hybrid + Rerank | 已实现主干 | **未通过** | 需要先修回归问题 |
| Phase 5 | Policy / Gate / Replay | 未开始 | 未验收 | 暂缓 |
| Phase 6 | UX / KB 管理 | 部分完成 | 未验收 | 暂缓 |
| Phase 7 | 持久化 / 部署 | 未开始 | 未验收 | 暂缓 |

---

## 重排后的实施顺序

### Stage A — Phase 4 预修复：检索链路可信化

> 这是插队阶段，优先级高于继续推进 Phase 5。

### 目标
修复会污染后续 eval、回归、参数化发布判断的基础问题，确保 Phase 4 至少回到“可验证状态”。

### 范围
1. **Ingest 上传链路一致性**
   - 前端多文件上传 vs 后端单文件接口对齐
   - 明确单文件/多文件能力边界
2. **Hybrid 低信心判定校正**
   - 检查 `RagService` 是否错误使用混合分数语义
   - 防止所有 case 被误判为 clarify
3. **运行态核验**
   - 确认 embedding / BM25 / RRF / rerank 实际启用情况
   - 确认 trace 与 `/rag/retrieve` 字段可解释
4. **回归基线恢复**
   - 至少恢复到不低于 Phase 3 基线

### 验收标准
1. 30 个 eval cases 不再出现 `clarify_rate = 1` 的退化。
2. `Recall@K` 恢复到 **≥ Phase 3 基线**。
3. `/rag/retrieve` 返回的 `strategy / degraded / degrade_reason` 与实际运行一致。
4. 上传能力边界清晰：若支持多文件则后后端真支持；若不支持则前端限制为单文件并给出提示。
5. 产出：
   - `PHASE4_FIX_ACCEPTANCE.md`
   - `docs/phases/PHASE4_FIX_OUTCOME.md`

### 完成后提交要求
- commit: `fix(phase4): restore hybrid retrieval baseline`
- push: `origin/main`

---

### Stage B — Phase 4 正式验收：混合检索 + 重排

### 目标
在可信运行态上完成 Phase 4 验收，达成可量化效果改进。

### 范围
1. BM25 / 向量 / RRF 参数调优
2. rerank 降级策略稳定化
3. `kb_version` 与 `reindex` 验证
4. 用 eval runs 给出真实对比结果

### 验收标准
1. 30 个 eval cases 可稳定跑完。
2. `Recall@K` 达到目标，或至少给出明确的 gap 和 blocker。
3. `Context-hit` 不低于 Phase 3。
4. `PHASE4_ACCEPTANCE.md` 更新为正式通过或明确标红未过原因。
5. 产出 `docs/phases/PHASE4_OUTCOME.md`。

### 完成后提交要求
- commit: `feat(phase4): validate hybrid retrieval pipeline`
- push: `origin/main`

---

### Stage C — Phase 5：参数化发布 + 阈值门禁 + Replay

### 目标
把现有检索/生成策略从“代码内硬编码”升级为“可配置、可对比、可回放”的工程系统。

### 子任务
1. `policy.yaml`
2. `thresholds.yaml`
3. compare 结果自动 gate 判定
4. replay 最小闭包
5. trace 写入 `policy_version`

### 验收标准
1. 策略切换不改代码，仅改配置。
2. Compare 可输出 `ROLLBACK REQUIRED` 或 `MANUAL REVIEW`。
3. 指定 `request_id` 可 replay。
4. 产出：
   - `PHASE5_ACCEPTANCE.md`
   - `docs/phases/PHASE5_OUTCOME.md`

### 完成后提交要求
- commit: `feat(phase5): add policy gate and replay`
- push: `origin/main`

---

### Stage D — Phase 6：前端体验与知识库管理

### 目标
补齐知识库产品化体验，而不是只做聊天 demo。

### 子任务
1. 来源可视化增强
2. 文件库管理
3. 历史会话
4. clarify / abstain UX 优化

### 验收标准
1. 文件列表可查看、删除。
2. 来源片段展示完整。
3. 多轮会话本地可恢复。
4. 产出：
   - `PHASE6_ACCEPTANCE.md`
   - `docs/phases/PHASE6_OUTCOME.md`

### 完成后提交要求
- commit: `feat(phase6): improve knowledge base UX`
- push: `origin/main`

---

### Stage E — Phase 7：持久化与部署

### 目标
让系统从“内存原型”升级为“可部署应用”。

### 子任务
1. 向量库持久化
2. 元数据库
3. Session 持久化
4. Docker Compose
5. metrics / cost alert

### 验收标准
1. 服务重启后知识库不丢。
2. Docker 一键起全栈。
3. 产出：
   - `PHASE7_ACCEPTANCE.md`
   - `docs/phases/PHASE7_OUTCOME.md`

### 完成后提交要求
- commit: `feat(phase7): add persistence and deployment stack`
- push: `origin/main`

---

## 阶段文档规范

每个阶段必须至少维护 2 份文档：

1. **验收文档**（仓库根目录）
   - 例如：`PHASE4_FIX_ACCEPTANCE.md`
   - 用于记录验收标准、命令、结果、风险

2. **成果文档**（`docs/phases/`）
   - 例如：`docs/phases/PHASE4_FIX_OUTCOME.md`
   - 用于记录本阶段做了什么、为什么这么做、关键设计点、后续影响

---

## 当前立即执行项

### Now
开始 **Stage A — Phase 4 预修复：检索链路可信化**。

### 本阶段优先级
1. 查清并修复上传链路一致性
2. 查清 `clarify_rate = 1` 的根因
3. 恢复 eval 基线
4. 留下阶段验收与成果文档
5. commit + push
