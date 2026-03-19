# Phase 5 Plan — Policy / Gate / Replay

## 目标
把当前可运行的 RAG 链路升级为“可配置、可比较、可回放”的工程系统。

## 本阶段范围
1. 新增 `server/config/policy.yaml`
2. 新增 `server/eval/thresholds.yaml`
3. trace 写入 `policy_version` 与最小 replay 输入
4. eval compare 读取门禁并输出结论
5. 补阶段文档与 commit/push

## 验收标准
- 不改业务代码即可替换策略版本号
- `/rag/trace/:id` 能看到 `policy_version`
- compare 报告包含 gate verdict
- 产出 focused commit 并 push

## 暂不做
- 完整 UI 化策略编辑
- 大型 replay 平台
- 持久化向量库切换
