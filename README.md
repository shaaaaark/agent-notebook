# Agent Notebook

> 基于 RAG 的个人知识库助手。上传笔记、文档或 PDF，通过流式对话向知识库提问，答案附带来源引用。

![stack](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![stack](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![stack](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![stack](https://img.shields.io/badge/LangChain-OpenAI-412991?logo=openai&logoColor=white)

---

## 功能概览

- **文档摄取** — 拖拽或点击上传 `.md` / `.txt` / `.pdf`，支持多文件批量上传
- **RAG 问答** — 基于上传文档进行语义检索，流式返回带引用标注的答案
- **每日复习** — 每天 20:00（Asia/Shanghai）自动触发文档摘要，辅助知识回顾
- **调试接口** — 内置 `/rag/debug` 端点，可查看当前 LLM 配置（Key 脱敏）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端框架 | NestJS 11 · TypeScript |
| LLM 集成 | LangChain / `@langchain/openai` |
| 流式传输 | 原生 Fetch SSE + Server-Sent Events |
| 文件解析 | `pdf-parse`（PDF）· 原生字符串（MD/TXT）|
| 文件上传 | `multer` diskStorage |
| 定时任务 | `@nestjs/schedule` Cron |
| 前端框架 | React 19 · TypeScript · Vite 8 |
| Markdown 渲染 | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| SSE 客户端 | `@microsoft/fetch-event-source` |

## 项目结构

### 文档导航

- `ROADMAP.md`：产品路线图与阶段目标
- `docs/execution/`：执行计划与当前下一步
- `docs/acceptance/`：阶段验收记录
- `docs/phases/`：阶段成果与设计总结


```
agent-notebook/
├── server/                        # NestJS 后端（端口 8788）
│   ├── src/
│   │   ├── providers/
│   │   │   └── llm.provider.ts    # LLM & Embeddings 封装
│   │   └── modules/
│   │       ├── config/            # 环境配置（ConfigModule）
│   │       ├── ingest/            # 文件上传与解析  POST /ingest/file
│   │       ├── rag/               # RAG 问答引擎    POST /rag/ask
│   │       └── schedule/          # 每日复习 Cron
│   ├── eval/
│   │   ├── cases/                 # 回归测试 Case（20 个，JSON 格式）
│   │   └── README.md              # Eval 体系说明
│   ├── scripts/
│   │   └── seed.ts                # 批量导入笔记的种子脚本
│   ├── uploads/                   # 上传文件存储目录（.gitignore 保护）
│   └── .env.example               # 环境变量模板
├── web/                           # React 前端
│   └── src/
│       ├── App.tsx                # 主界面（侧栏上传 + 主聊天区）
│       └── App.css                # 样式（暖纸色主题）
├── docs/
│   ├── acceptance/               # 阶段验收记录
│   ├── execution/                # 执行计划 / 下一步 / 阶段计划
│   └── phases/                   # 阶段成果文档
├── .gitignore
└── ROADMAP.md                     # 7 阶段演进路线图
```

## 快速开始

### 前置要求

- Node.js ≥ 18
- 任意 OpenAI 兼容的 API（OpenAI / Azure / 本地代理均可）

### 1. 克隆与安装

```bash
git clone git@github.com:shaaaaark/agent-notebook.git
cd agent-notebook

# 安装后端依赖
cd server && npm install

# 安装前端依赖
cd ../web && npm install
```

### 2. 配置环境变量

```bash
cd server
cp .env.example .env
```

编辑 `.env`：

```env
OPENAI_BASE_URL=https://api.openai.com/v1   # 或你的代理地址
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

### 3. 启动服务

```bash
# 终端 1 — 启动后端（端口 8788）
cd server && npm run start:dev

# 终端 2 — 启动前端（端口 5173，自动代理到后端）
cd web && npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)

### 4. 导入测试数据（可选）

如果你有 `md-collection/ai_progress/` 目录下的学习笔记，可以一键导入：

```bash
cd server
npx ts-node scripts/seed.ts
# 默认读取 ../../md-collection/ai_progress/，需后端已启动
```

## API 文档

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/ingest/file` | 上传文件，`multipart/form-data`，字段名 `file` |
| `GET` | `/ingest/status` | 查看当前知识库的文档数、chunk 数、最后更新时间与 `kb_version` |
| `POST` | `/ingest/reindex` | 基于当前进程已摄取文档重建向量/BM25 索引并轮转 `kb_version` |
| `POST` | `/rag/ask` | 问答，JSON `{ "question": "..." }`，SSE 流式响应 |
| `GET` | `/rag/retrieve` | 调试检索，`?q=关键词`，返回 topK chunks + scores |
| `GET` | `/rag/debug` | 查看当前 LLM 配置（API Key 已脱敏） |

**SSE 事件格式（`/rag/ask`）**

```
event: message
data: 生成的文本片段

event: done
data:
```

## 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8788` | 后端监听端口 |
| `CHUNK_SIZE` | `500` | 分块大小（字符） |
| `CHUNK_STEP` | `200` | 分块步长（字符） |
| `RETRIEVE_TOP_K` | `8` | 最终进入 RAG 主流程的候选数 |
| `RETRIEVE_TOP_K_VEC` | `50` | 向量召回 topK |
| `RETRIEVE_TOP_K_BM25` | `50` | BM25 召回 topK |
| `RETRIEVE_FUSED_TOP_N` | `30` | RRF 融合后保留的候选数 |
| `RETRIEVE_RRF_K` | `60` | RRF 公式中的 rank 平滑常数 |
| `RERANK_TOP_M` | `8` | 进入 rerank 的候选数 |
| `MAX_CONTEXT_TOKENS` | `2000` | Context Builder token 预算 |
| `MAX_CHUNKS_PER_SOURCE` | `2` | 单文档最大入 context chunk 数 |
| `COVERAGE_MIN_GAIN` | `0.05` | 覆盖优先的边际增益阈值 |
| `ABSTAIN_THRESHOLD` | `0.35` | Clarify/Abstain 阈值 |
| `RETRIEVE_TIMEOUT_MS` | `500` | 检索总超时 |
| `RERANK_TIMEOUT_MS` | `500` | rerank 超时，超时后回退到 RRF 排序 |
| `LLM_TIMEOUT_MS` | `10000` | LLM 超时 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API 基础地址 |
| `OPENAI_API_KEY` | — | API 密钥（必填）|
| `OPENAI_MODEL` | `gpt-4o-mini` | 对话模型 |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 向量化模型 |
| `RERANK_PROVIDER` | `bailian` | rerank provider，当前默认使用百炼 |
| `RERANK_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | rerank 模型标识；若使用本地 rerank 才会消费本地模型 |
| `VECTOR_STORE` | `memory` | 向量存储类型（当前仅支持 `memory`）|
| `SCHEDULE_TIMEZONE` | `Asia/Shanghai` | 定时任务时区 |
| `REVIEW_CRON` | `0 20 * * *` | 复习任务 Cron 表达式 |

## 开发路线

项目当前已完成 **Phase 1-3**，下一阶段是 **Phase 4（混合检索 + Rerank）**：

```
Phase 0 ✅  纯内存 RAG 基线
Phase 1 ✅  文档分块 + 向量检索 + 引用标注
Phase 2 ✅  Context Builder + 可观测 Trace + Abstain 策略
Phase 3 ✅  Eval Harness（30 个回归 Case）
Phase 4     混合检索（向量 + BM25）+ Rerank
Phase 5     参数化发布 + 灰度分桶 + Replay 框架
Phase 6     持久化（Qdrant + SQLite）+ Docker 部署
```

详细实现规划见 [ROADMAP.md](./ROADMAP.md)。执行顺序与当前优先级见 [`docs/execution/EXECUTION_PLAN.md`](./docs/execution/EXECUTION_PLAN.md)。

## 回归测试

`server/eval/cases/` 下已预置 30 个测试 Case，覆盖：

- 检索质量（Recall@K、混合检索参数）
- Context Builder（去重、覆盖、压缩策略）
- 可观测性（Trace 字段、调试路径、Abstain 触发条件）
- 发布工程（参数化、回滚阈值、灰度分桶、Replay）
- 评估体系（指标定义、Eval Harness 设计）

Eval Harness 已支持单次运行和 run 间对比：

```bash
npx ts-node eval/harness.ts --run-id baseline_$(date +%Y%m%d)
npx ts-node eval/harness.ts --compare baseline_20260316 baseline_20260323
```

## License

MIT
