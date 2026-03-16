import { useMemo, useRef, useState, useCallback } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import './App.css'

type Role = 'user' | 'assistant' | 'system'

type Message = {
  id: string
  role: Role
  content: string
}

const nowId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`

const SAMPLE_PROMPTS = [
  '用 3 个要点解释什么是 RAG',
  '帮我总结最近上传的笔记',
  '给我一个关于向量检索的可执行方案',
  '请基于资料回答：RAG 的召回不足怎么排查？',
]

function App() {
  const [messages, setMessages] = useState<Message[]>([{
    id: nowId(),
    role: 'assistant',
    content: '你好，我是你的 Agent Notebook。上传资料后，我会基于笔记帮你回答问题。',
  }])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [debugInfo, setDebugInfo] = useState('')
  const [debugLoading, setDebugLoading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const chatRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const latestAssistantId = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    return last?.id
  }, [messages])

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      chatRef.current?.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }

  const appendMessage = (msg: Message) => {
    setMessages((prev) => [...prev, msg])
    scrollToBottom()
  }

  const streamBufferRef = useRef('')
  const rafRef = useRef<number | null>(null)

  const updateAssistantMessage = (id: string, chunk: string) => {
    streamBufferRef.current += chunk
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      const delta = streamBufferRef.current
      streamBufferRef.current = ''
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
      )
      rafRef.current = null
      scrollToBottom()
    })
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return
    setError('')

    const question = input.trim()
    setInput('')

    const userMessage: Message = { id: nowId(), role: 'user', content: question }
    appendMessage(userMessage)

    const assistantId = nowId()
    appendMessage({ id: assistantId, role: 'assistant', content: '' })

    setIsStreaming(true)

    try {
      await fetchEventSource('/rag/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
        onmessage(ev) {
          if (ev.event === 'done') {
            setIsStreaming(false)
            return
          }
          if (ev.data) {
            updateAssistantMessage(assistantId, ev.data)
          }
        },
        onerror(err) {
          console.error(err)
          setError('流式请求失败，请稍后重试。')
          setIsStreaming(false)
        },
      })
    } catch (err) {
      console.error(err)
      setError('请求失败，请检查后端是否已启动。')
      setIsStreaming(false)
    }
  }

  const addFiles = useCallback((incoming: File[]) => {
    const allowed = incoming.filter((f) =>
      ['.md', '.txt', '.pdf'].some((ext) => f.name.toLowerCase().endsWith(ext)),
    )
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...allowed.filter((f) => !existing.has(f.name + f.size))]
    })
  }, [])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(Array.from(event.target.files))
    event.target.value = ''
  }

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const handleUpload = async () => {
    if (!files.length || uploading) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('file', file))

      const res = await fetch('/ingest/file', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        throw new Error('upload failed')
      }

      appendMessage({
        id: nowId(),
        role: 'system',
        content: `已上传 ${files.length} 个文件，可以开始提问。`,
      })
      setFiles([])
    } catch (err) {
      console.error(err)
      setError('上传失败，请检查后端日志。')
    } finally {
      setUploading(false)
    }
  }

  const handleDebug = async () => {
    if (debugLoading) return
    setDebugLoading(true)
    setError('')
    try {
      const res = await fetch('/rag/debug')
      if (!res.ok) {
        throw new Error('debug failed')
      }
      const data = await res.json()
      setDebugInfo(JSON.stringify(data, null, 2))
    } catch (err) {
      console.error(err)
      setError('获取调试信息失败，请检查后端是否已启动。')
    } finally {
      setDebugLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">AN</div>
          <div>
            <h1>Agent Notebook</h1>
            <p>RAG 知识库助手</p>
            <span className="brand-tag">Editorial RAG Studio</span>
          </div>
        </div>
        <div className="upload-card">
          <h2>上传资料</h2>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.txt,.pdf"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div
            className={`drop-zone${isDragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <span className="drop-hint">点击或拖拽文件到此处</span>
            <span className="drop-sub">支持 .md · .txt · .pdf</span>
          </div>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={f.name + f.size} className="file-item">
                  <span className="file-name" title={f.name}>{f.name}</span>
                  <span className="file-size">{formatSize(f.size)}</span>
                  <button
                    className="file-remove"
                    onClick={() => handleRemoveFile(i)}
                    disabled={uploading}
                    aria-label="移除"
                  >×</button>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
            <button
              className="primary upload-btn"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <><span className="spinner" />上传中…</>
              ) : (
                `上传 ${files.length} 个文件`
              )}
            </button>
          )}
        </div>
        <div className="prompt-card">
          <h2>示例问题</h2>
          <ul>
            {SAMPLE_PROMPTS.map((item) => (
              <li key={item}>
                <button onClick={() => setInput(item)}>{item}</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="debug-card">
          <div className="debug-header">
            <h2>调试入口</h2>
            <button className="secondary" onClick={handleDebug} disabled={debugLoading}>
              {debugLoading ? '获取中…' : '获取配置'}
            </button>
          </div>
          <p>查看后端实际读取到的 baseUrl/model（key 已脱敏）。</p>
          <pre className="debug-box">{debugInfo || '暂无数据'}</pre>
        </div>
      </aside>

      <main className="chat-area">
        <header>
          <div>
            <h2>对话</h2>
            <span>{isStreaming ? 'Agent 正在思考…' : '准备就绪'}</span>
          </div>
        </header>

        <section className="chat-window" ref={chatRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`bubble ${msg.role}`}>
              <div className="meta">
                <span>{msg.role === 'assistant' ? 'Agent' : msg.role === 'user' ? '你' : '系统'}</span>
                <span className="meta-dot" />
                <span className="meta-chip">{msg.role.toUpperCase()}</span>
              </div>
              <div className={`content ${msg.role === 'assistant' && msg.id === latestAssistantId && isStreaming ? 'typing' : ''}`}>
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {msg.content || '…'}
                  </ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
        </section>

        {error && <div className="error-banner">{error}</div>}

        <footer className="composer">
          <textarea
            placeholder="输入你的问题…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <button className="primary" onClick={handleSend} disabled={!input.trim() || isStreaming}>
            发送
          </button>
        </footer>
      </main>
    </div>
  )
}

export default App
