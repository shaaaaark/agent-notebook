# Agent Notebook — Execution Plan

> 目标：保持 `ROADMAP.md` 作为产品主线不变，同时把实施顺序、验收要求与当前优先级整理成一份长期可维护的执行文档。

## 文档职责

- 产品主线：`ROADMAP.md`
- 执行主线：`docs/execution/EXECUTION_PLAN.md`
- 近期行动：`docs/execution/NEXT_STEP_PLAN.md`
- 阶段验收：`docs/acceptance/`
- 阶段成果：`docs/phases/`

## 执行原则

1. **主线不变**：功能目标以 `ROADMAP.md` 为准。
2. **顺序可调**：允许因依赖、阻塞或回归风险调整阶段顺序，但必须说明原因。
3. **阶段闭环**：每个阶段尽量形成完整闭环：范围、实现、验证、文档、提交。
4. **结果优先**：不要把“代码已写完”等同于“阶段通过”；以验收结果为准。
5. **减少文档漂移**：把长期有效的规则写在这里，把临时状态写进 `docs/execution/NEXT_STEP_PLAN.md` 或具体验收文档。

## 当前阶段评估

| 阶段 | 路线目标 | 当前状态 | 验收状态 | 结论 |
|---|---|---:|---:|---|
| Phase 1 | MVP 闭环 | 已实现 | 已通过 | 保留结果 |
| Phase 2 | Context + Trace | 已实现 | 已通过 | 保留结果 |
| Phase 3 | Eval 体系 | 已实现第一版 | 已通过 | 保留结果 |
| Phase 4 | Hybrid + Rerank | 已实现主干 | 未通过 | 继续收口与验证 |
| Phase 5 | Policy / Gate / Replay | 部分推进 | 未验收 | 待 Phase 4 收口后继续 |
| Phase 6 | UX / KB 管理 | 部分完成 | 未验收 | 暂缓 |
| Phase 7 | 持久化 / 部署 | 未开始 | 未验收 | 暂缓 |

## 推荐实施顺序

### Stage A — Phase 4 检索链路可信化

目标：确保 Phase 4 至少回到“运行态可信、可解释、可验证”的状态。

优先事项：
1. 摄取与上传链路一致性
2. clarify / abstain 判定与混合分数语义校正
3. `/rag/retrieve`、trace、降级信息对齐真实运行态
4. eval 基线恢复

验收产物：
- `docs/acceptance/PHASE4_FIX_ACCEPTANCE.md`
- `docs/phases/PHASE4_FIX_OUTCOME.md`

### Stage B — Phase 4 正式验收

目标：在可信运行态上完成混合检索 + 重排的正式验证。

范围：
1. BM25 / 向量 / RRF 参数调优
2. rerank 降级策略稳定化
3. `kb_version` / `reindex` 验证
4. 真实 eval run 对比

验收产物：
- `docs/acceptance/PHASE4_ACCEPTANCE.md`
- `docs/phases/PHASE4_OUTCOME.md`

### Stage C — Phase 5 参数化发布 + Gate + Replay

目标：把策略从硬编码升级为可配置、可对比、可回放的工程系统。

范围：
1. `policy.yaml`
2. `thresholds.yaml`
3. compare 结果 gate 判定
4. replay 最小闭包
5. trace 写入 `policy_version`

验收产物：
- `docs/acceptance/PHASE5_ACCEPTANCE.md`
- `docs/phases/PHASE5_OUTCOME.md`

### Stage D — Phase 6 前端体验与知识库管理

目标：把系统从“能聊”推进到“更像知识库产品”。

范围：
1. 来源可视化增强
2. 文件库管理
3. 历史会话
4. clarify / abstain UX 优化

### Stage E — Phase 7 持久化与部署

目标：把系统从内存原型升级为可部署应用。

范围：
1. 向量库持久化
2. 元数据库
3. Session 持久化
4. Docker Compose
5. metrics / cost alert

## 阶段文档规范

每个阶段至少维护两类文档：

1. **验收文档**：位于 `docs/acceptance/`
   - 记录验收标准、执行命令、结果、风险、结论
2. **成果文档**：位于 `docs/phases/`
   - 记录本阶段做了什么、为何这样做、关键设计点与后续影响

## 当前立即执行项

当前默认优先处理：
1. Phase 4 收口与可信化
2. 恢复 / 验证真实 eval 基线
3. 再进入 Phase 5 的参数化与 replay 能力建设
