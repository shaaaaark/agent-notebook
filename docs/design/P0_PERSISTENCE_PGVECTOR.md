# P0 Persistence Design — PostgreSQL + pgvector

> 目标：为 `agent-notebook` 引入最小但可用的知识库持久化层，解决内存型知识库在重启、实例切换、评测、回放中的不稳定问题。

---

## 1. 背景

当前知识库依赖进程内内存状态，已在实际开发中造成：

- 服务重启后知识库清空
- seed 结果依附于具体实例
- eval / replay / trace 难以保持一致的知识库基线
- 运行态不稳定直接影响 Phase 4 收口

因此，当前将“知识库最小持久化 / 向量落库”上调为 **P0**。

---

## 2. 目标与非目标

### 2.1 目标

P0 需要解决：

1. 文档、chunk、向量在服务重启后可恢复
2. `ingest/status` 不再依赖进程内状态
3. `reindex` 可以从持久化数据重建索引状态
4. `ask / retrieve / trace` 基于稳定知识库工作
5. eval / replay 不再因实例切换导致空库

### 2.2 非目标

P0 暂不追求：

- 多节点高可用
- 分布式部署
- 完整云原生化
- 复杂权限系统
- GraphQL API 自动暴露层
- 将所有检索逻辑都下沉到数据库

---

## 3. 技术决策

### 3.1 数据库
- **PostgreSQL**
- **pgvector** 扩展

### 3.2 核心模型
采用三表模型：

1. `kb_documents`
2. `kb_chunks`
3. `kb_embeddings`

### 3.3 架构原则

- PostgreSQL 是知识库真相源（source of truth）
- pgvector 负责向量检索能力
- 现有 BM25 / RRF / rerank 继续保留在应用层
- P0 只替换知识库存储与 vector backend，不全面重写 Phase 4 检索链路

---

## 4. 数据模型

## 4.1 `kb_documents`

表示文档级对象。

```sql
create table kb_documents (
  id uuid primary key,
  source_key text not null unique,
  title text,
  category text,
  original_filename text,
  content_hash text not null,
  content_type text,
  status text not null default 'active',
  kb_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ingested_at timestamptz
);
```

### 字段说明
- `source_key`: 文档逻辑唯一来源，建议使用相对路径或业务路径
- `content_hash`: 文档级内容 hash，用于去重与更新判断
- `status`: `active / deleted / archived`
- `kb_version`: 最近一次参与构建时对应的知识库版本

---

## 4.2 `kb_chunks`

表示 chunk 级对象，是 retrieval 回填文本与 citation 的核心表。

```sql
create table kb_chunks (
  id uuid primary key,
  document_id uuid not null references kb_documents(id),
  chunk_id text not null unique,
  chunk_index int not null,
  total_chunks int,
  text_content text not null,
  text_hash text not null,
  token_count int,
  source text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);
```

### 字段说明
- `chunk_id`: 必须稳定、唯一；后续 trace / replay / reindex 都依赖它
- `text_content`: chunk 正文
- `source`: 用于 display / eval / citation / debug
- `active`: 支持软删除与增量更新

---

## 4.3 `kb_embeddings`

表示向量层，负责 pgvector 检索。

```sql
create table kb_embeddings (
  id uuid primary key,
  chunk_id text not null references kb_chunks(chunk_id),
  embedding_model text not null,
  embedding_version text,
  vector vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chunk_id, embedding_model, embedding_version)
);
```

> `vector(1536)` 仅为示例，实际维度应与当前 embedding model 对齐。

### 字段说明
- `embedding_model`: 当前 embedding 模型名
- `embedding_version`: 便于后续模型升级与重建
- `vector`: pgvector 向量列

---

## 5. 索引建议

### `kb_documents`
- `unique(source_key)`
- `index(status)`

### `kb_chunks`
- `unique(chunk_id)`
- `unique(document_id, chunk_index)`
- `index(document_id)`
- `index(source)`
- `index(active)`

### `kb_embeddings`
- `unique(chunk_id, embedding_model, embedding_version)`
- pgvector ANN index（后续按版本与实际规模选择 `ivfflat` 或 `hnsw`）

---

## 6. 数据流改造

## 6.1 Ingest 流程

### 当前
- 文件读取
- 切块
- embedding
- 存入内存

### 改造后
1. 上传文件 / 读取文本
2. 计算文档 hash
3. upsert `kb_documents`
4. 切块并生成稳定 `chunk_id`
5. upsert `kb_chunks`
6. 生成 embedding
7. upsert `kb_embeddings`
8. 更新 `kb_version` / `last_ingested_at`

### 关键点
- 文档更新时不能只追加，必须支持按 `source_key` / hash 替换
- chunk 删除建议先做软删除（`active=false`）
- embedding 重建应与 chunk 状态一致

---

## 6.2 Retrieve 流程

### 当前
- query embedding
- 内存向量检索
- 返回 chunk

### 改造后
1. `embedQuery(query)`
2. `kb_embeddings` 上做 pgvector topK
3. 返回命中的 `chunk_id`
4. join `kb_chunks`
5. 组装 `RetrievedChunk[]`
6. 与 BM25 结果在应用层融合
7. 继续执行 RRF / rerank / context builder

### 关键点
- pgvector 只替代 vector search backend
- BM25 / RRF / rerank 先不下沉数据库
- 这样能最小化对现有 Phase 4 链路的冲击

---

## 6.3 Reindex 流程

`POST /ingest/reindex` 的新语义：

1. 读取 active `kb_chunks`
2. 重新计算 embedding
3. 覆盖写入 `kb_embeddings`
4. 刷新 `kb_version`
5. 返回新的 count / version / timestamp

### 关键点
- `reindex` 以后不只是重建内存，而是重建持久化向量状态
- 必须支持从数据库恢复，而不是依赖 seed 重跑

---

## 6.4 Status 流程

`GET /ingest/status` 以后应直接读数据库：

- 文档数
- chunk 数
- kb_version
- 最后更新时间

这样 status 不再依赖具体进程实例。

---

## 7. 模块划分建议

建议新增/改造以下模块：

### 7.1 `KbRepository`
负责：
- 文档、chunk、embedding 的持久化读写
- upsert / soft delete / stats

### 7.2 `VectorStore` 抽象
定义统一接口：

```ts
interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(queryVector: number[], topK: number): Promise<VectorHit[]>;
  deleteBySource(source: string): Promise<void>;
  clear(): Promise<void>;
  rebuild(chunks: EmbeddedChunk[]): Promise<void>;
  getStats(): Promise<VectorStoreStats>;
}
```

建议实现：
- `InMemoryVectorStore`（兼容/回退/测试）
- `PgVectorStore`（P0 正式实现）

### 7.3 Retrieval 层
改造 `HybridRetrieverService`：
- 不再直接依赖进程内 store 作为唯一真相源
- vector hits 来自 `PgVectorStore`
- 文本与 metadata 通过 repository 回填

---

## 8. 迁移顺序建议

### Step 1
引入 PostgreSQL 与 pgvector 依赖，建立 schema

### Step 2
新增 repository 层，完成 documents / chunks / embeddings 的 CRUD

### Step 3
把 ingest 改为写数据库

### Step 4
把 vector retrieval 改为 pgvector

### Step 5
保留 BM25 / RRF / rerank，恢复现有检索主链路

### Step 6
改造 `status` / `reindex`

### Step 7
验证：seed → restart → ask / retrieve / trace → eval smoke

---

## 9. 验收标准（P0）

必须满足：

1. seed 一次后，服务重启知识库不丢
2. `document_count / chunk_count / kb_version` 在重启前后一致
3. `ask / retrieve / trace / status / reindex` 重启后仍可用
4. eval 不再因实例切换导致空库
5. 当前 learning notes 语料可稳定导入并可重复 smoke 验证

---

## 10. 当前不做什么

P0 暂不做：

- GraphQL / PostGraphile 暴露层
- 多租户
- 高可用主从
- 全量 PostgreSQL Full Text Search 替代现有 BM25
- 复杂 KB 权限模型

这些都可以后续再做，但不应阻塞当前持久化主线。

---

## 11. 一句话结论

P0 的最优路线是：

> **让 PostgreSQL 成为知识库真相源，让 pgvector 成为 vector backend，而不是继续依赖进程内内存知识库。**
