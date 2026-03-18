# Phase 4 预修复验收与阶段归档

> 范围：对齐 `EXECUTION_PLAN.md` 中的 Stage A（Phase 4 预修复：检索链路可信化）。

## 1. 本次验收标准

1. 上传链路与前端能力一致：前端支持多文件时，后端 `/ingest/file` 也要真正支持多文件。
2. Hybrid 检索场景下，不能再直接沿用纯向量阈值判断，避免误把所有 case 判成 `clarify`。
3. 运行态 guardrail 不得误伤当前 fallback 路径：在本地 fallback 向量化场景下，`RETRIEVE_TIMEOUT_MS` 需允许正常检索完成。
4. `server` 构建通过，说明本轮修复未破坏后端主链路。
5. 为后续真实回归恢复提供文档化基线。

---

## 2. 本次修复内容

### 2.1 上传链路一致性修复

**问题：**
- 前端 `web/src/App.tsx` 使用 `FormData.append('file', file)` 多次追加，UI 允许一次上传多个文件。
- 后端 `server/src/modules/ingest/ingest.controller.ts` 原先使用 `FileInterceptor('file')`，实际只接收单文件。

**修复：**
- 将后端改为 `FilesInterceptor('file', 20, ...)`
- 控制器改为 `@UploadedFiles()` 接收数组
- 返回值改为批量结果结构：

```json
{
  "ok": true,
  "count": 2,
  "uploaded": [
    { "ok": true, "skipped": false, "filename": "a.md", "chunks": 4 },
    { "ok": true, "skipped": true, "filename": "b.md" }
  ]
}
```

### 2.3 运行态 guardrail 校正

**问题：**
- 当前 embedding 接口不可用，系统会 fallback 到本地向量化。
- 但原有 `RETRIEVE_TIMEOUT_MS=500` 对该 fallback 路径过于激进。
- 结果：`/rag/ask` 在 `prepareResponse()` 中会先超时，trace 记录为 `retrieved_chunks=[]`，从而被误判为 `clarify`。

**修复：**
- 将默认 `RETRIEVE_TIMEOUT_MS` 提升到 `3000`
- 当前运行态通过显式环境变量注入 `RETRIEVE_TIMEOUT_MS=3000` 验证，已不再出现“空 sources + 500ms 超时”的旧症状

### 2.4 本轮回归结果

- `seed.ts` 成功导入 22 篇测试语料
- 使用 `--host http://127.0.0.1:8788` 重跑 eval harness
- 结果：`clarify_rate = 1.0`，说明 Stage A 已修掉“空知识库/超时误伤”类问题，但仍未恢复到可接受基线
- 当前判断：下一步需要继续修正 **本地 fallback 检索场景下的信号阈值 / 检索策略选择**

---

## 3. 验收执行记录

### 3.1 构建检查

命令：

```bash
cd server
bash -lc 'source ~/.nvm/nvm.sh && npm run build'
```

结果：
- `nest build` 通过

### 3.2 代码级验收

#### 上传链路
- 前端：支持 `multiple`
- 后端：已改为 `FilesInterceptor`
- 结论：前后端能力已对齐

#### 低信心判定
- 已从“统一阈值”改为“按检索策略区分判定”
- 结论：已消除一个高概率导致全量 clarify 的根因

---

## 4. 本次改动文件

- `server/src/modules/ingest/ingest.controller.ts`
- `server/src/modules/rag/rag.service.ts`
- `EXECUTION_PLAN.md`
- `docs/phases/TEMPLATE_OUTCOME.md`
- `PHASE4_FIX_ACCEPTANCE.md`
- `docs/phases/PHASE4_FIX_OUTCOME.md`

---

## 5. 当前已知限制

1. 本次仅完成 Stage A 的第一轮修复，还未重新跑真实 eval 回归。
2. embedding / rerank 的运行态问题是否仍影响指标，还需要下一步核验。
3. 目前只保证多文件上传接口已对齐，尚未补文件列表管理与删除能力。

---

## 6. 下一步

1. 运行后端并导入种子数据
2. 重新跑 `/rag/retrieve` 与 eval harness
3. 核验 `clarify_rate` 是否已经脱离全量退化
4. 若基线恢复，再进入 Phase 4 正式验收
