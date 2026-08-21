import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_URL_KEY = 'xinwen_api_url'
const API_TOKEN_KEY = 'xinwen_api_token'
const suggestions = [
  'TIM1 怎么设置互补 PWM 和死区？',
  '这块开发板的晶振接在哪些引脚？',
  'ADC 的最大采样率是多少？',
]

function defaultApiUrl() {
  if (window.location.port === '8765') return window.location.origin
  return 'http://127.0.0.1:8765'
}

function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(API_URL_KEY) || defaultApiUrl())
  const [token, setToken] = useState(() => localStorage.getItem(API_TOKEN_KEY) || '')
  const [draftApiUrl, setDraftApiUrl] = useState(apiUrl)
  const [draftToken, setDraftToken] = useState(token)
  const [health, setHealth] = useState({ status: 'checking', documents: 0, generator: 'retrieval_only' })
  const [documents, setDocuments] = useState([])
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const fileInputRef = useRef(null)
  const conversationRef = useRef(null)

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  )

  const request = useCallback(async (path, options = {}) => {
    const base = apiUrl.replace(/\/$/, '')
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.detail || `请求失败 (${response.status})`)
    return payload
  }, [apiUrl, headers])

  const loadDocuments = useCallback(async () => {
    const payload = await request('/api/documents')
    setDocuments(payload.documents || [])
    return payload.documents || []
  }, [request])

  const checkService = useCallback(async () => {
    try {
      const state = await request('/api/health')
      setHealth(state)
      await loadDocuments()
    } catch {
      setHealth({ status: 'offline', documents: 0, generator: 'retrieval_only' })
    }
  }, [request, loadDocuments])

  useEffect(() => {
    checkService()
    const timer = window.setInterval(checkService, 30000)
    return () => window.clearInterval(timer)
  }, [checkService])

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, asking])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function askQuestion(text) {
    const cleanQuestion = text.trim()
    if (!cleanQuestion || asking) return

    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: cleanQuestion }])
    setQuestion('')
    setAsking(true)
    try {
      const payload = await request('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQuestion, doc_id: selectedDoc, top_k: 5 }),
      })
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: payload.answer,
        sources: payload.sources || [],
        mode: payload.mode,
      }])
    } catch (error) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `暂时无法回答：${error.message}。请检查左下角的本机服务是否已经连接。`,
        error: true,
      }])
    } finally {
      setAsking(false)
    }
  }

  function submitQuestion(event) {
    event.preventDefault()
    askQuestion(question)
  }

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      askQuestion(question)
    }
  }

  async function uploadFile(file) {
    if (!file || uploading) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      const payload = await request('/api/documents', { method: 'POST', body: form })
      setToast(`${payload.document.name} 已加入知识库`)
      await loadDocuments()
      await checkService()
    } catch (error) {
      setToast(error.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    uploadFile(event.dataTransfer.files?.[0])
  }

  function saveSettings(event) {
    event.preventDefault()
    const nextUrl = draftApiUrl.trim().replace(/\/$/, '') || defaultApiUrl()
    const nextToken = draftToken.trim()
    localStorage.setItem(API_URL_KEY, nextUrl)
    if (nextToken) localStorage.setItem(API_TOKEN_KEY, nextToken)
    else localStorage.removeItem(API_TOKEN_KEY)
    setApiUrl(nextUrl)
    setToken(nextToken)
    setSettingsOpen(false)
    setHealth({ status: 'checking', documents: 0, generator: 'retrieval_only' })
  }

  const online = health.status === 'ok'
  const activeDocName = documents.find((doc) => doc.id === selectedDoc)?.name

  return (
    <main className="page-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">芯</span>
          <div><strong>芯问</strong><small>Chip Manual AI</small></div>
        </div>

        <button className="new-chat" type="button" onClick={() => setMessages([])}>
          <span aria-hidden="true">＋</span>新建对话
        </button>

        <section className="library" aria-labelledby="library-title">
          <div className="section-heading"><p id="library-title">知识库</p><span>{documents.length}</span></div>
          <div className="doc-list">
            {documents.map((doc, index) => (
              <button
                className={`doc-item ${selectedDoc === doc.id ? 'active' : ''}`}
                type="button"
                key={doc.id}
                onClick={() => setSelectedDoc((current) => current === doc.id ? null : doc.id)}
                title={selectedDoc === doc.id ? '再次点击取消限定' : '只搜索这份文档'}
              >
                <span className={`doc-icon ${['mint', 'blue', 'amber'][index % 3]}`} aria-hidden="true">PDF</span>
                <span><strong>{doc.name}</strong><small>{doc.pages} 页 · {doc.chunks} 个片段</small></span>
                <i aria-hidden="true">{selectedDoc === doc.id ? '✓' : '›'}</i>
              </button>
            ))}
            {!documents.length && <div className="empty-library">{online ? '还没有文档' : '连接后显示文档'}</div>}
          </div>
        </section>

        <div className={`local-card ${online ? 'online' : health.status}`}>
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{online ? '本机服务已连接' : health.status === 'checking' ? '正在连接' : '本机服务未连接'}</strong>
            <small>{online ? (health.generator === 'ollama' ? `${health.model} 回答` : '资料检索模式') : '点击右侧进行设置'}</small>
          </div>
          <button type="button" aria-label="连接设置" onClick={() => setSettingsOpen(true)}>•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">EMBEDDED KNOWLEDGE ASSISTANT</p><h1>让芯片手册，<em>开口回答。</em></h1></div>
          <button className="round-button" type="button" aria-label="网站设置" onClick={() => setSettingsOpen(true)}>⚙</button>
        </header>

        <section
          className={`upload-card ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
          aria-label="上传芯片手册"
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="upload-symbol" aria-hidden="true">{uploading ? '⋯' : '↑'}</div>
          <div className="upload-copy">
            <strong>{uploading ? '正在解析并建立索引，请稍等…' : '把新的芯片手册放进知识库'}</strong>
            <span>{uploading ? '大型参考手册可能需要几分钟' : '拖入 PDF、DOCX 或 TXT，系统会在本机完成解析和索引'}</span>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.c,.h,.epub" onChange={(event) => uploadFile(event.target.files?.[0])} hidden />
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '处理中' : '选择文件'}</button>
        </section>

        <section className="chat-card">
          <div className="chat-head">
            <div className="ai-avatar" aria-hidden="true">AI</div>
            <div><strong>手册问答</strong><span><i /> {activeDocName ? `当前只查：${activeDocName}` : '依据全部已索引资料回答'}</span></div>
            {activeDocName && <button className="clear-filter" type="button" onClick={() => setSelectedDoc(null)}>取消限定</button>}
          </div>

          <div className="conversation" ref={conversationRef} aria-live="polite">
            {!messages.length && (
              <>
                <div className="message ai-message">
                  <p>你好，我已经连接到当前的芯片资料库。</p>
                  <p>你可以问寄存器、引脚、时序或板级连接问题，我会同时给出手册页码。</p>
                </div>
                <div className="suggestions" aria-label="示例问题">
                  {suggestions.map((item) => <button type="button" key={item} onClick={() => askQuestion(item)}>{item}</button>)}
                </div>
              </>
            )}

            {messages.map((message) => (
              <article className={`message-row ${message.role}`} key={message.id}>
                <div className={`message ${message.error ? 'error-message' : ''}`}>{message.content}</div>
                {!!message.sources?.length && (
                  <details className="source-panel">
                    <summary>{message.sources.length} 条手册依据</summary>
                    <div className="source-list">
                      {message.sources.map((source, index) => (
                        <details className="source-item" key={`${source.doc_id}-${source.page}-${index}`}>
                          <summary className="source-summary">
                            <span className="source-index">{index + 1}</span>
                            <span className="source-meta">
                              <strong>{source.document} · 第 {source.page} 页</strong>
                              <small>{source.section || '相关内容'}</small>
                            </span>
                            <span className="source-action" aria-hidden="true">
                              <span className="show-label">展开原文</span>
                              <span className="hide-label">收起原文</span>
                              <i>⌄</i>
                            </span>
                          </summary>
                          <div className="source-content">
                            <div className="source-content-head">
                              <strong>检索到的手册原文</strong>
                              <span>第 {source.page} 页</span>
                            </div>
                            <p>{source.content || '这条依据暂时没有可显示的原文。'}</p>
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                )}
              </article>
            ))}

            {asking && <div className="thinking" aria-label="正在查询手册"><span /><span /><span />正在查手册</div>}
          </div>

          <form className="composer" onSubmit={submitQuestion}>
            <textarea
              aria-label="输入问题"
              rows="1"
              placeholder={online ? '问一个芯片问题…' : '请先启动本机服务…'}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={asking}
            />
            <div className="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" disabled={!question.trim() || asking} aria-label="发送问题">↑</button></div>
          </form>
        </section>
      </section>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <form className="settings-modal" onSubmit={saveSettings} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><p>本机连接</p><h2>连接到你的 em-rag</h2></div>
              <button type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <label>服务地址<input value={draftApiUrl} onChange={(event) => setDraftApiUrl(event.target.value)} placeholder="http://127.0.0.1:8765" /></label>
            <label>连接口令（可选）<input type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder="本机使用可以留空" /></label>
            <p className="settings-tip">在自己的电脑上使用默认地址即可；通过公网访问时再填写安全通道地址。</p>
            <button className="save-settings" type="submit">保存并重新连接</button>
          </form>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  )
}

export default App
