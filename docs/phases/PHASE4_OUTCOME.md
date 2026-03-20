# Phase 4 Outcome — 混合检索 + Rerank 当前收口状态

> 这不是“正式验收通过”文档，而是对当前运行态的阶段性结论归档：哪些东西已经真实可用，哪些问题仍阻止 Phase 4 关闭。

## 一句话结论

Phase 4 的**主干能力已经落地**：

- 向量检索 + BM25 + RRF + rerank 的链路已经接入
- `/rag/retrieve`、trace、`/ingest/status`、`/ingest/reindex` 等调试与运维接口已经补齐
- 当前默认 rerank provider 已切到 **Bailian**，比本地 rerank 更适合作为运行时主路径

但 **Phase 4 仍未正式关闭**，原因不是“没实现”，而是“运行质量与验收稳定性还不够硬”。

---

## 已经落地的能力

### 1. 检索主链路升级为混合检索

当前检索链路已从纯向量检索升级为：

1. 向量召回
2. BM25 召回
3. RRF 融合
4. rerank 重排
5. Context Builder 选择最终证据

这意味着系统已经具备：

- 兼顾语义匹配与词面命中
- 在中文查询场景下保留 lexical signal
- 为后续 Recall / Context-hit 调优提供更合理的工程基础

### 2. 降级信息已经显式化

在 rerank 不可用、BM25 信号不足或检索路径退化时，系统会显式输出：

- `strategy`
- `degraded`
- `degrade_reason`
- chunk 级 `score_vec / score_bm25 / score_rrf / rerank_score`
- `rank_vec / rank_bm25 / rank_final`

这件事很重要：后面再看回归，不会再出现“结果变差了但不知道是哪一级链路塌了”的黑盒状态。

### 3. 知识库状态管理补齐

已补齐：

- `GET /ingest/status`
- `POST /ingest/reindex`
- `kb_version`
- `last_updated_at`

这让知识库不再只是“一个进程内数组”，而是至少具备了：

- 当前索引状态可见
- 版本切换可见
- 全量重建可执行

### 4. 默认 rerank 运行策略明确

当前环境下，本地 rerank 依赖 Hugging Face 模型拉取，运行中容易出现：

- 模型下载失败
- 初始化过慢
- 首次调用超时
- 回归结果受运行环境干扰过大

因此当前结论已经明确：

- **Bailian rerank 作为默认主路径**
- 本地 rerank 仅保留为候选/离线兜底思路
- 不再把本地 rerank 作为当前主线验收前提

这不是“放弃本地能力”，而是先把项目推进建立在更稳定的地基上。

---

## 当前仍阻塞 Phase 4 关闭的问题

### 1. 真实回归质量还不够稳

虽然链路已经完整，但 Phase 4 的核心目标不是“能跑”，而是：

- 召回质量可信
- 回答链路与检索逻辑一致
- clarify / abstain 不要过度保守
- 回归结果能稳定复现

此前真实 eval 中出现过：

- 大面积 `clarify`
- `Recall@K` 明显回落
- `Context-hit` 接近失真

这说明问题已经从“功能缺失”进入“策略语义与运行质量不匹配”阶段。

### 2. 中文问题下的排序质量还需要继续验证

当前最值得继续验证的不是接口是否存在，而是：

- 中文 query 是否能稳定触发足够强的 lexical signal
- rerank 后的前排 chunk 是否真的比 RRF 前排更相关
- Context Builder 是否把真正有用的 chunk 挤掉了

换句话说，接下来该盯的是“相关性排序质量”，不是继续堆能力点。

### 3. 低信心判定仍需要持续调校

目前系统已经有 clarify / abstain / degraded 的护栏，但还需要继续校正：

- hybrid 分数语义与 `minScoreThreshold` / `abstainThreshold` 的匹配关系
- 多弱信号场景下是否过早拒答
- rerank 不可用时是否放大了保守倾向

如果这块不继续收口，就会出现一种很烦的假象：

> 检索其实捞到了东西，但生成链路先怂了。

这会直接拖垮 Phase 4 的真实验收。

---

## 当前阶段最重要的决策

### 决策 1：主线继续围绕 notebook 本体，而不是账号调度

sub2api 账号池维护、坏号清理、调度保洁，这些事情可以做，但它们不再占主线。当前主线已重新聚焦到：

- notebook 检索与回答质量
- eval 稳定性
- 可观测与可复跑性

### 决策 2：默认 rerank 固定为 Bailian

当前阶段不再把“把本地 rerank 跑顺”当作关闭 Phase 4 的前置条件。主线优先级是：

1. 保证运行态稳定
2. 保证真实回归可信
3. 在此基础上再考虑本地能力补齐

### 决策 3：先收口 Phase 4，再推进 Phase 5

Phase 5 的 policy / thresholds / replay 已有部分实现，但主线不应在 Phase 4 还摇晃时继续前冲。顺序上应当是：

1. 先把 Phase 4 的运行态和回归质量收稳
2. 再把当前策略抽象为更正式的 policy / gate / replay 体系

---

## 推荐的下一批动作

### P1. 重跑真实 eval，并保留 run 间对比

目标：确认当前 Bailian 主路径下，30-case 的真实表现有没有回到可接受区间。

关注指标：

- Recall@K
- Context-hit
- clarify_rate
- citation_presence_rate
- degraded 分布

### P2. 定点检查“已有证据却过早 clarify”的 case

对低分 case 做 case-by-case 排查，重点看：

- retrieval topK 是否已经包含 gold source
- Context Builder 是否误杀
- prompt 与最终回答是否过度保守

### P3. 固化当前运行基线

把当前推荐配置、默认 provider、常用验证命令、真实知识库导入方式固化成开发基线，避免后续回归每次都被环境差异带偏。

---

## 当前状态标签

- **能力实现**：已完成主干
- **运行可信度**：已恢复到可继续验证
- **正式验收**：未关闭
- **当前主线**：继续推进 notebook，优先收口 Phase 4 质量
