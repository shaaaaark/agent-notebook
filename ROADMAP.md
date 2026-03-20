# Agent Notebook — Roadmap

> 目标：把当前 `agent-notebook` 从“已经具备 RAG 主干能力的原型”推进为**可验证、可调优、可持续演进**的 NotebookLM-like Agent（NestJS + React + RAG）。
>
> **重要说明**：本文件不是历史回顾，也不是功能许愿池；它是当前项目的**产品与工程主线**。执行时以“当前阶段是否通过 gate”为最高判断标准。

---

## 0. 当前项目定位

当前项目已经不处于“从零到一”阶段，而处于：

- 主链路已通
- 关键模块已落地
- 但 Phase 4 仍未正式收口

因此，roadmap 的重点不再是“继续罗列未来可能做什么”，而是：

1. 先把当前链路收稳
2. 让 eval / trace / replay 真正能指导决策
3. 在阶段 gate 通过后，再推进更高阶能力

一句话：

> **先把系统做成“可判断、可解释、可回归”，再追求更多能力层。**

---

## 1. 当前基线（截至现在）

### 已经具备的能力

- 文件 ingest、切块、基础知识库管理
- `/rag/ask` SSE 流式回答
- `/rag/retrieve` 检索调试入口
- 向量检索 + BM25 + RRF + rerank 的混合检索主干
- `ContextBuilder` 选择最终上下文
- Request trace 基础能力
- eval cases / harness / runs 第一版
- `kb_version` / `reindex` / `status` 等知识库运维能力
- low-confidence / clarify / abstain 的初步诊断字段
- eval failure draft 采集入口

### 当前仍未收口的问题

- 中文 query 下的检索相关性仍需验证
- “有证据却 clarify / abstain”的问题仍需系统排查
- rerank 不可用时的降级语义虽已可见，但还需真实 run 验证
- Phase 4 目前仍缺少足够硬的 gate 来宣布“通过”

---

## 2. 路线原则

### 原则 1：阶段 gate 高于新增功能
如果当前阶段没有通过 gate，默认**不扩张后续阶段能力范围**。

### 原则 2：诊断优先于调参
在不知道失败属于 retrieval、context、guardrail、generation 哪一层之前，**不要先堆阈值和策略补丁**。

### 原则 3：真实 eval 高于主观感觉
“看起来更合理”不能代替 run 产物。是否继续推进，以真实 eval、trace、失败样本分析为准。

### 原则 4：避免并行主线
当前只保留一个主线阶段。后续阶段可以设计，但**不能与当前阶段并行争夺优先级**。

### 原则 5：文档服务决策，不服务叙事
roadmap、execution、acceptance 文档都应帮助做取舍；不写“看起来很完整但无法裁决”的描述性废话。

---

## 3. 当前阶段总览

| 阶段 | 目标 | 当前状态 | 是否主线 |
|---|---|---:|---:|
| Phase 1 | MVP 闭环 | 已完成 | 否 |
| Phase 2 | Context + Trace 基础 | 已完成 | 否 |
| Phase 3 | Eval 体系第一版 | 已完成 | 否 |
| **P0** | **知识库最小持久化 / 向量落库** | **必须立即推进** | **是（当前前置主线）** |
| **Phase 4** | Hybrid Retrieval + Rerank 收口 | **进行中，未通过 gate** | **是（P0 完成后恢复）** |
| Phase 5 | Policy / Gate / Replay 工程化 | 已设计，暂缓扩张 | 否 |
| Phase 6 | UX / KB 管理增强 | 部分有想法，暂缓 | 否 |
| Phase 7 | 完整部署工程化 | 未开始，暂缓 | 否 |

---

## 4. 当前前置主线：P0 知识库最小持久化

### 4.1 为什么 P0 必须先做

当前知识库仍然是进程内内存状态，这已经不再只是“以后优化”的问题，而是在真实开发中直接造成：

- 服务重启后知识库归零
- seed 结果依附于具体进程
- eval / replay 运行结果不稳定
- 调试成本被环境问题放大

因此，当前必须先完成一个**最小但可用的持久化层**，让知识库和向量状态在服务重启后仍然可恢复。

### 4.2 P0 的目标

P0 的目标不是一步到位做完整生产级向量平台，而是：

> **先让知识库具备“重启不丢、状态可恢复、评测可重复”的最小持久化能力。**

### 4.3 P0 范围

本阶段优先解决：

- 文档元信息持久化
- chunk 持久化
- 向量持久化
- 启动恢复索引
- `ingest/status` / `reindex` / `seed` 在重启后仍可工作

明确不在本阶段追求：

- 多节点部署
- 高可用集群
- 复杂分片
- 完整监控告警系统
- 全量云原生化

### 4.4 P0 通过 gate（必须同时满足）

#### A. 持久化 gate
- seed 一次后，服务重启知识库不丢
- `document_count / chunk_count / kb_version` 在重启前后保持一致
- 文档、chunk、向量可以从持久化介质恢复

#### B. 运行 gate
- `ask / retrieve / trace / ingest/status / reindex` 在重启后仍可正常工作
- eval 不再因实例切换导致空库

#### C. 开发效率 gate
- 日常开发不再需要“每次重启都重新 seed”
- smoke 验证可在稳定知识库状态下重复执行

### 4.5 P0 完成后的恢复顺序

P0 完成后，恢复到原主线：

1. Phase 4 diagnostics / eval readiness
2. failure bucket
3. retrieval / context / clarify 定点优化
4. Phase 4 验收
5. Phase 5 参数化与 replay 工程化

---

## 5. 当前主线：Phase 4 收口

### 5.1 Phase 4 的目标

Phase 4 的目标不是“把混合检索功能写出来”，而是：

> **让混合检索 + rerank 在真实知识库和真实问题上，达到可信、可解释、可回归的状态。**

这意味着必须同时满足：

- 检索链路存在
- 运行退化可见
- 失败原因可分层诊断
- eval 能稳定重跑
- 回答与检索结果逻辑一致

### 4.2 Phase 4 当前优先级顺序

在 Phase 4 通过前，优先级固定为：

1. **失败原因可观测**
2. **失败样本可复盘 / 可分桶**
3. **真实 eval 可稳定重跑**
4. **检索 / Context / guardrail 的定点调优**
5. **正式验收与结果归档**

禁止倒序做事。尤其禁止：

- 在 failure reason 还不清楚时大范围调阈值
- 在 eval 还不稳定时推进 Phase 5 扩张项

### 4.3 Phase 4 通过 gate（必须同时满足）

#### A. 功能 gate
- `/rag/retrieve` 返回真实运行态调试字段：
  - `strategy`
  - `degraded`
  - `degrade_reason`
  - chunk 级分数/排序信息
- trace 能记录：
  - `final_status`
  - `final_reason`
  - `clarify_reason / abstain_reason`
  - retrieval / context 诊断字段
- 失败样本采集入口能输出可用于 triage 的 draft

#### B. 运行 gate
- 真实知识库可完成 reset + reseed + reindex 流程
- `rag/ask`、`rag/retrieve`、trace 查询链路可正常工作
- build / 关键测试稳定通过

#### C. 评测 gate
- 30-case eval 可以稳定跑完
- 至少产出：
  - `metrics.json`
  - `trace.jsonl`
  - `report.md`
- 需要重点观察：
  - `Recall@K`
  - `Context-hit`
  - `clarify_rate`
  - `abstain_rate`
  - degraded 分布

#### D. 诊断 gate
- clarify / abstain 不再只是结果标签，而是能分辨至少以下几类原因：
  - `retrieve_timeout`
  - `empty_retrieval`
  - `context_filtered_empty`
  - `weak_signal`
- 对主要失败类型，能够明确落到以下三类之一：
  - retrieval 不足
  - context 选择问题
  - guardrail / generation 判定问题

#### E. 文档 gate
- 阶段状态与验收结果同步更新：
  - `docs/acceptance/PHASE4_ACCEPTANCE.md`
  - `docs/phases/PHASE4_OUTCOME.md`
  - `docs/execution/NEXT_STEP_PLAN.md`

### 4.4 Phase 4 的停止 / 让路规则

以下情况出现时，**不继续扩张功能面**：

1. eval 无法稳定重跑
2. failure reason 仍无法分层解释
3. 上游偶发问题（如 502 / timeout）占据主要波动来源
4. 主要失败原因尚未明确落桶

当出现这些情况时，默认动作不是进入 Phase 5，而是继续回到：

- trace / failure draft
- replay / eval
- retrieval / context / clarify 诊断

---

## 6. 下一阶段：Phase 5（仅在 Phase 4 通过后开启）

### 6.1 Phase 5 的定位

Phase 5 不是当前并行主线，而是：

> **当 Phase 4 已经“可判断、可解释、可回归”后，再把策略层升级为可配置、可对比、可回放的工程系统。**

### 5.2 Phase 5 范围

仅在 Phase 4 通过后，才正式推进：

- `policy.yaml`
- `thresholds.yaml`
- compare / gate 判定
- replay 最小闭环强化
- `policy_version` 与 trace / run 对账

### 5.3 为什么现在不把它设为主线

因为当前最关键的问题不是“缺少策略配置文件”，而是：

- 失败还未充分解释
- eval 还未成为稳定裁决依据
- Clarify / Abstain 的真实失败模式还在收口

在这种状态下先大推 Phase 5，只会让系统看起来更工程化，但更难判断是否真的变好。

---

## 7. 后续阶段（暂缓，不并行抢资源）

### Phase 6 — UX / KB 管理增强
适合在 Phase 4/5 之后推进：

- 来源可视化
- 文件库管理
- 历史会话
- clarify / abstain 的用户体验优化

### Phase 7 — 持久化 / 部署
适合在 Phase 5 之后推进：

- 向量库持久化
- 元数据库
- Session 持久化
- Docker Compose
- metrics / cost alert

这些方向都合理，但当前**不是主线**。

---

## 8. 当前推荐开发顺序（严格执行）

### Step 0
先完成 P0：知识库最小持久化 / 向量落库
- 解决重启丢库
- 解决实例切换导致的空库
- 建立稳定的 eval / replay 基线

### Step 1
继续补强 Phase 4 的 diagnostics / eval readiness：
- trace 原因字段
- failure draft 采集
- replay / triage 入口

### Step 2
重跑真实 eval，拿到足够多的 failure samples：
- 识别 clarify / abstain 的主因分布
- 判断主要问题在 retrieval / context / guardrail 哪一层

### Step 3
基于 failure bucket 做定点优化：
- retrieval 召回
- ContextBuilder 过滤策略
- clarify / abstain 判定

### Step 4
完成 Phase 4 正式验收：
- 指标
- 产物
- 文档
- 结论

### Step 5
只有在 Step 4 完成后，才进入 Phase 5

---

## 8. 当前不做什么

为了减少战略性分心，当前默认**不作为主线推进**的包括：

- 账号池维护 / 调度策略类工作
- 无关的大范围重构
- 无明确验收价值的文档美化
- 提前扩张前端体验层功能
- 在 Phase 4 未通过时并行建设完整 Phase 5 框架

---

## 9. 这个 roadmap 如何使用

- `ROADMAP.md`：定义当前主线、阶段边界、gate 与 defer 规则
- `docs/execution/EXECUTION_PLAN.md`：把 roadmap 变成执行顺序
- `docs/execution/NEXT_STEP_PLAN.md`：记录当前最近的一小段最优先动作
- `docs/acceptance/`：阶段验收证据
- `docs/phases/`：阶段结果与关键决策归档

如果执行动作无法映射到当前 roadmap 主线条目，默认**不应优先实现**。

---

## 10. 一句话版

当前项目的唯一主线是：

> **先把 Phase 4 做到可判断、可解释、可回归，再进入 Phase 5 的参数化与回放工程化。**
