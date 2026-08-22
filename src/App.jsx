import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import './App.css'
import 'katex/dist/katex.min.css'

const API_URL_KEY = 'xinwen_api_url'
const API_TOKEN_KEY = 'xinwen_api_token'
const CHAT_HISTORY_KEY = 'xinwen_chat_history_v1'
const PUBLIC_API_URL = (import.meta.env.VITE_PUBLIC_API_URL || '').replace(/\/$/, '')
const PUBLIC_UPLOAD_LIMIT_MB = 30
const MAX_SAVED_CHATS = 20
const MAX_CONTEXT_MESSAGES = 32
const suggestionPool = [
  'TIM1 怎么设置互补 PWM 和死区？',
  '这块开发板的晶振接在哪些引脚？',
  'ADC 的最大采样率是多少？',
  'STM32F407 的启动模式怎么选择？',
  '如何配置 SPI 的时钟极性和相位？',
  'DMA 循环模式适合哪些场景？',
  'NVIC 中断优先级应该怎么设置？',
  'CAN 波特率需要配置哪些参数？',
  'USB 功能对时钟有什么要求？',
  '独立看门狗超时时间怎么计算？',
  'USART 波特率寄存器怎么配置？',
  'GPIO 复用功能应该怎么选择？',
  'I²C 接口为什么需要上拉电阻？',
  'PLL 怎样配置到 168 MHz？',
  '提高主频后 Flash 等待周期怎么设置？',
  '芯片的电源引脚应该怎样接电容？',
  'ADC 扫描模式和连续模式有什么区别？',
  '定时器编码器模式应该怎么配置？',
  '这块开发板的按键和 LED 接在哪些引脚？',
]
const engineeringSuggestionPool = [
  '我要用 TIM1 驱动半桥，CH1/CH1N 和死区怎么接线？',
  '这块开发板的电源、VDDA、VCAP 应该怎样连接？',
  '外部晶振、负载电容和 STM32 引脚怎么连接？',
  'NRST 复位按键、上拉电阻和调试接口怎么接？',
  '这块板的 USB、串口和 JTAG/SWD 分别接哪些引脚？',
  'W25Q16 外部 Flash 怎样连接到 SPI1？',
  'I²C 传感器的 SCL、SDA 上拉电阻怎么连接？',
  'ADC 模拟输入前端需要哪些滤波和接地连接？',
  'BOOT0 和 BOOT1 启动电阻应该怎样接？',
  'STM32F407 与 CAN 收发器之间需要连接哪些信号？',
  '调试下载接口的 SWDIO、SWCLK、NRST 怎么连接？',
  'PWM 输出接电机驱动器时需要检查哪些连接和保护？',
  '板上的 LED、按键和扩展排针分别连接到哪些引脚？',
  'USB D+、D− 周围的电阻和接口应该怎样连接？',
  '定时器编码器模式的 CH1、CH2 输入如何布线？',
  '芯片各个电源引脚旁边的去耦电容如何布置？',
]

function createRandomSuggestions(previous = [], pool = suggestionPool) {
  let selection = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shuffled = [...pool]
    const randomValues = new Uint32Array(shuffled.length)
    crypto.getRandomValues(randomValues)
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = randomValues[index] % (index + 1)
      ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
    }
    selection = shuffled.slice(0, 3)
    if (selection.join('\n') !== previous.join('\n')) break
  }
  return selection
}

function defaultApiUrl() {
  if (window.location.port === '8765') return window.location.origin
  return PUBLIC_API_URL || 'http://127.0.0.1:8765'
}

function isLoopbackUrl(value) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(value || '')
}

function initialApiUrl() {
  const saved = localStorage.getItem(API_URL_KEY)
  if (PUBLIC_API_URL && window.location.hostname === 'norman6666.github.io') {
    localStorage.setItem(API_URL_KEY, PUBLIC_API_URL)
    return PUBLIC_API_URL
  }
  if (PUBLIC_API_URL && isLoopbackUrl(saved) && window.location.port !== '8765') {
    localStorage.setItem(API_URL_KEY, PUBLIC_API_URL)
    return PUBLIC_API_URL
  }
  return saved || defaultApiUrl()
}

function loadSavedChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]')
    if (!Array.isArray(saved)) return []
    return saved
      .filter((chat) => chat && typeof chat.id === 'string' && Array.isArray(chat.messages))
      .map((chat) => ({
        id: chat.id,
        title: typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim() : '未命名对话',
        messages: chat.messages.filter((message) => message?.role && typeof message.content === 'string'),
        assistantMode: chat.assistantMode === 'engineering' ? 'engineering' : 'qa',
        createdAt: Number(chat.createdAt) || Date.now(),
        updatedAt: Number(chat.updatedAt) || Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SAVED_CHATS)
  } catch {
    return []
  }
}

function compactChatsForStorage(chats) {
  return chats.slice(0, MAX_SAVED_CHATS).map((chat) => ({
    ...chat,
    messages: chat.messages.slice(-40).map((message) => ({
      ...message,
      sources: message.sources?.slice(0, 5).map((source) => ({
        ...source,
        content: source.content?.slice(0, 1200),
      })),
    })),
  }))
}

function titleFromQuestion(question) {
  const oneLine = question.replace(/\s+/g, ' ').trim()
  return oneLine.length > 22 ? `${oneLine.slice(0, 22)}…` : oneLine
}

const pdfBulletPattern = /^(?:[•●▪◦○·*+-]|\d+[.)])\s*/
const pdfSectionPattern = /^(?:\d+(?:\.\d+)+|(?:table|figure)\s+\d+)[.)]?\s+/i

function isPdfBoilerplate(line, index) {
  if (index >= 8) return false
  return /^[A-Z]{2,}\d+\s+Rev(?:ision)?\s+\d+$/i.test(line)
    || /^\d+\s*\/\s*\d+$/.test(line)
    || (/^STM32[A-Z0-9xX, ]+$/.test(line) && line.includes(','))
    || /^\d{1,4}$/.test(line)
}

function isStructuralPdfLine(line) {
  return pdfBulletPattern.test(line)
    || pdfSectionPattern.test(line)
    || /^(?:table|figure)\b/i.test(line)
}

function canJoinPdfLines(previous, current) {
  if (!previous || !current || isStructuralPdfLine(previous) || isStructuralPdfLine(current)) return false
  if (/[。！？.!?;；:：]$/.test(previous)) return false
  if (/^[a-z0-9(["'“‘]/.test(current)) return true
  return /(?:\band|or|the|of|to|for|with|in|on|by|from|as|via|与|和|及|的|为|在|以及)\s*$/i.test(previous)
}

function cleanPdfText(value) {
  if (typeof value !== 'string') return ''
  const lines = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\u200b]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index) => !isPdfBoilerplate(line, index))

  const cleaned = []
  for (const line of lines) {
    if (!line) {
      if (cleaned.length && cleaned.at(-1) !== '') cleaned.push('')
      continue
    }
    if (cleaned.length && cleaned.at(-1) !== '' && canJoinPdfLines(cleaned.at(-1), line)) {
      cleaned[cleaned.length - 1] = `${cleaned.at(-1)} ${line}`.trim()
    } else {
      cleaned.push(line)
    }
  }
  while (cleaned.at(-1) === '') cleaned.pop()
  return cleaned.join('\n')
}

function linkEvidenceCitations(content, messageId, sources = []) {
  if (!content || !sources.length) return content
  return content.split('\n').map((line) => {
    const isSummaryLine = /^\s*依据\s*[：:]/.test(line)
    return line.replace(/\[(\d{1,2})\]/g, (match, number) => {
      const index = Number(number)
      if (!Number.isInteger(index) || index < 1 || index > sources.length) return match
      const page = sources[index - 1]?.page
      const label = page ? `${index}·第${page}页` : `${index}`
      const title = isSummaryLine ? ' "summary"' : ''
      return `[${label}](#evidence-${messageId}-${index}${title})`
    })
  }).join('\n')
}

function normalizeMarkdownTables(content) {
  if (!content || !content.includes('|')) return content
  // Qwen 偶尔会把表头、分隔线和第一行压到同一行；先恢复最基本的 Markdown 表格换行。
  const hasSeparator = /\|\s*:?-{3,}\s*\|/.test(content)
  if (!hasSeparator) return content
  return content
    .replace(/\|\s*\|(?=\s*:?-{3,})/g, '|\n|')
    .replace(/\|\s*(?=\d+\s*\|)/g, '\n|')
}

function evidencePageSummary(sources = []) {
  const pages = [...new Set(sources.map((source) => source.page).filter(Boolean))]
  return pages.length ? ` · 第 ${pages.join('、')} 页` : ''
}

function splitEvidenceSources(content, sources = []) {
  const citedIndices = new Set(
    [...(content || '').matchAll(/\[(\d{1,2})\]/g)]
      .map((match) => Number(match[1]))
      .filter((index) => Number.isInteger(index) && index >= 1 && index <= sources.length),
  )
  const items = sources
    .map((source, index) => ({ source, index, cited: citedIndices.has(index + 1) }))
    .sort((left, right) => Number(right.cited) - Number(left.cited) || left.index - right.index)
  return { citedCount: citedIndices.size, relatedCount: sources.length - citedIndices.size, items }
}

function MarkdownEvidenceLink({ href, children, title, ...props }) {
  if (!href?.startsWith('#evidence-')) {
    return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
  }
  function openEvidence(event) {
    event.preventDefault()
    const target = document.getElementById(href.slice(1))
    if (!target) return
    target.open = true
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const className = title === 'summary' ? 'evidence-ref evidence-summary-ref' : 'evidence-ref'
  return <a href={href} className={className} title="查看对应手册依据" onClick={openEvidence} {...props}>{children}</a>
}

function formatChatTime(timestamp) {
  const date = new Date(timestamp)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function App() {
  const [initialChats] = useState(loadSavedChats)
  const [apiUrl, setApiUrl] = useState(initialApiUrl)
  const [token, setToken] = useState(() => localStorage.getItem(API_TOKEN_KEY) || '')
  const [draftApiUrl, setDraftApiUrl] = useState(apiUrl)
  const [draftToken, setDraftToken] = useState(token)
  const [health, setHealth] = useState({ status: 'checking', documents: 0, generator: 'retrieval_only' })
  const [documents, setDocuments] = useState([])
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [chatHistory, setChatHistory] = useState(initialChats)
  const [activeChatId, setActiveChatId] = useState(initialChats[0]?.id || null)
  const [messages, setMessages] = useState(initialChats[0]?.messages || [])
  const [question, setQuestion] = useState('')
  const [assistantMode, setAssistantMode] = useState(initialChats[0]?.assistantMode || 'qa')
  const [suggestions, setSuggestions] = useState(() => createRandomSuggestions(
    [],
    initialChats[0]?.assistantMode === 'engineering' ? engineeringSuggestionPool : suggestionPool,
  ))
  const [asking, setAsking] = useState(false)
  const [searchStartedAt, setSearchStartedAt] = useState(0)
  const [searchElapsed, setSearchElapsed] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [retrievalInfoOpen, setRetrievalInfoOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [adminDocuments, setAdminDocuments] = useState([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [deletingDoc, setDeletingDoc] = useState('')
  const [renamingDoc, setRenamingDoc] = useState('')
  const [toast, setToast] = useState('')
  const fileInputRef = useRef(null)
  const conversationRef = useRef(null)

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  )

  const requestAt = useCallback(async (baseUrl, path, options = {}) => {
    const base = baseUrl.replace(/\/$/, '')
    const method = (options.method || 'GET').toUpperCase()
    const response = await fetch(`${base}${path}`, {
      ...options,
      cache: options.cache || (method === 'GET' ? 'no-store' : 'default'),
      headers: { ...headers, ...(options.headers || {}) },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(payload.detail || `请求失败 (${response.status})`)
      error.status = response.status
      throw error
    }
    return payload
  }, [headers])

  const request = useCallback(
    (path, options = {}) => requestAt(apiUrl, path, options),
    [apiUrl, requestAt],
  )

  const loadDocumentsAt = useCallback(async (baseUrl) => {
    const payload = await requestAt(baseUrl, '/api/documents')
    setDocuments(payload.documents || [])
    return payload.documents || []
  }, [requestAt])

  const loadDocuments = useCallback(async () => {
    return loadDocumentsAt(apiUrl)
  }, [apiUrl, loadDocumentsAt])

  const checkService = useCallback(async ({ keepChecking = false } = {}) => {
    let activeBase = apiUrl
    let state
    try {
      state = await requestAt(activeBase, '/api/health')
    } catch {
      if (PUBLIC_API_URL && activeBase !== PUBLIC_API_URL) {
        try {
          activeBase = PUBLIC_API_URL
          state = await requestAt(activeBase, '/api/health')
          localStorage.setItem(API_URL_KEY, activeBase)
          setApiUrl(activeBase)
          setDraftApiUrl(activeBase)
        } catch {
          setHealth({ status: keepChecking ? 'checking' : 'offline', documents: 0, generator: 'retrieval_only' })
          return
        }
      } else {
        setHealth({ status: keepChecking ? 'checking' : 'offline', documents: 0, generator: 'retrieval_only' })
        return
      }
    }

    setHealth(state)
    try {
      await loadDocumentsAt(activeBase)
    } catch {
      setDocuments([])
    }
  }, [apiUrl, requestAt, loadDocumentsAt])

  useEffect(() => {
    checkService({ keepChecking: true })
    const retryDelays = [1500, 3500, 7000]
    const retryTimers = retryDelays.map((delay, index) => window.setTimeout(
      () => checkService({ keepChecking: index < retryDelays.length - 1 }),
      delay,
    ))
    const timer = window.setInterval(() => checkService(), 30000)
    return () => {
      retryTimers.forEach((retryTimer) => window.clearTimeout(retryTimer))
      window.clearInterval(timer)
    }
  }, [checkService])

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, asking])

  useEffect(() => {
    if (!asking || !searchStartedAt) return undefined
    const timer = window.setInterval(() => {
      setSearchElapsed(Math.floor((performance.now() - searchStartedAt) / 1000))
    }, 250)
    return () => window.clearInterval(timer)
  }, [asking, searchStartedAt])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(compactChatsForStorage(chatHistory)))
    } catch {
      // 浏览器空间不足时保留当前页面中的对话，不影响继续问答。
    }
  }, [chatHistory])

  function saveChatMessages(chatId, nextMessages) {
    if (!chatId) return
    // oxlint-disable-next-line react/purity -- runs only after a visitor sends a message
    const updatedAt = Date.now()
    setChatHistory((current) => {
      const active = current.find((chat) => chat.id === chatId)
      if (!active) return current
      const updated = { ...active, messages: nextMessages, updatedAt }
      return [updated, ...current.filter((chat) => chat.id !== chatId)].slice(0, MAX_SAVED_CHATS)
    })
  }

  async function askQuestion(text) {
    const cleanQuestion = text.trim()
    if (!cleanQuestion || asking) return

    let conversationId = activeChatId
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      // oxlint-disable-next-line react/purity -- runs only after a visitor starts a conversation
      const now = Date.now()
      setActiveChatId(conversationId)
      setChatHistory((current) => [{
        id: conversationId,
        title: titleFromQuestion(cleanQuestion),
        messages: [],
        assistantMode,
        createdAt: now,
        updatedAt: now,
      }, ...current].slice(0, MAX_SAVED_CHATS))
    }

    const userMessage = { id: crypto.randomUUID(), role: 'user', content: cleanQuestion }
    const pendingMessages = [...messages, userMessage]
    setMessages(pendingMessages)
    saveChatMessages(conversationId, pendingMessages)
    setQuestion('')
    // oxlint-disable-next-line react/purity -- captures the start time of this user action
    setSearchStartedAt(performance.now())
    setSearchElapsed(0)
    setAsking(true)
    try {
      const history = messages
        .slice(-MAX_CONTEXT_MESSAGES)
        .map(({ role, content }) => ({
          role,
          content: content.slice(-4000),
        }))
      const payload = await request('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: cleanQuestion, doc_id: selectedDoc, top_k: 5, history, assistant_mode: assistantMode }),
      })
      const answeredMessages = [...pendingMessages, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: payload.answer,
        sources: (payload.sources || []).map((source) => ({
          ...source,
          content: cleanPdfText(source.content),
        })),
        mode: payload.mode,
      }]
      setMessages(answeredMessages)
      saveChatMessages(conversationId, answeredMessages)
    } catch (error) {
      const failedMessages = [...pendingMessages, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `暂时无法回答：${error.message}。请检查左下角的问答服务是否已经连接。`,
        error: true,
      }]
      setMessages(failedMessages)
      saveChatMessages(conversationId, failedMessages)
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

  function startNewChat() {
    if (asking) return
    const pool = assistantMode === 'engineering' ? engineeringSuggestionPool : suggestionPool
    const nextSuggestions = createRandomSuggestions(suggestions, pool)
    setActiveChatId(null)
    setMessages([])
    setQuestion('')
    setSuggestions(nextSuggestions)
  }

  function changeAssistantMode(nextMode) {
    if (asking || nextMode === assistantMode) return
    setAssistantMode(nextMode)
    setSuggestions(createRandomSuggestions(
      suggestions,
      nextMode === 'engineering' ? engineeringSuggestionPool : suggestionPool,
    ))
    if (activeChatId) {
      setChatHistory((current) => current.map((chat) => (
        chat.id === activeChatId ? { ...chat, assistantMode: nextMode } : chat
      )))
    }
  }

  function openSavedChat(chat) {
    if (asking || chat.id === activeChatId) return
    setActiveChatId(chat.id)
    setMessages(chat.messages)
    setAssistantMode(chat.assistantMode || 'qa')
    setSuggestions(createRandomSuggestions(
      suggestions,
      chat.assistantMode === 'engineering' ? engineeringSuggestionPool : suggestionPool,
    ))
    setQuestion('')
  }

  function renameSavedChat(event, chat) {
    event.stopPropagation()
    if (asking) return
    const nextTitle = window.prompt('给这段对话起个名字', chat.title)?.trim()
    if (!nextTitle) return
    setChatHistory((current) => current.map((item) => (
      item.id === chat.id ? { ...item, title: nextTitle.slice(0, 36) } : item
    )))
  }

  function deleteSavedChat(event, chat) {
    event.stopPropagation()
    if (asking) return
    if (!window.confirm(`确定删除“${chat.title}”吗？`)) return
    const remaining = chatHistory.filter((item) => item.id !== chat.id)
    setChatHistory(remaining)
    if (activeChatId === chat.id) {
      setActiveChatId(remaining[0]?.id || null)
      setMessages(remaining[0]?.messages || [])
      setAssistantMode(remaining[0]?.assistantMode || 'qa')
      setSuggestions(createRandomSuggestions(
        suggestions,
        remaining[0]?.assistantMode === 'engineering' ? engineeringSuggestionPool : suggestionPool,
      ))
      setQuestion('')
    }
  }

  async function uploadFile(file) {
    if (!file || uploading) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setToast('公开体验只允许上传 PDF 芯片手册')
      return
    }
    if (file.size > PUBLIC_UPLOAD_LIMIT_MB * 1024 * 1024) {
      setToast(`文件太大，请上传 ${PUBLIC_UPLOAD_LIMIT_MB} MB 以内的 PDF`)
      return
    }
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

  async function loadAdminDocuments(currentToken = adminToken) {
    if (!currentToken) return
    setAdminLoading(true)
    setAdminError('')
    try {
      const payload = await request('/api/admin/documents', {
        headers: { 'X-Admin-Token': currentToken },
      })
      setAdminDocuments(payload.documents || [])
    } catch (error) {
      setAdminError(error.message)
      if (error.status === 401) {
        setAdminToken('')
        setAdminDocuments([])
      }
    } finally {
      setAdminLoading(false)
    }
  }

  function openAdminPanel() {
    setAdminOpen(true)
    setAdminError('')
    if (adminToken) loadAdminDocuments(adminToken)
  }

  async function loginAdmin(event) {
    event.preventDefault()
    if (!adminPassword || adminLoading) return
    setAdminLoading(true)
    setAdminError('')
    try {
      const payload = await request('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      })
      setAdminToken(payload.token)
      setAdminPassword('')
      await loadAdminDocuments(payload.token)
    } catch (error) {
      setAdminError(error.message)
    } finally {
      setAdminLoading(false)
    }
  }

  async function deleteAdminDocument(doc) {
    if (deletingDoc) return
    const confirmed = window.confirm(
      `确定把“${doc.name}”移出知识库吗？\n\n文件会保存在电脑的可恢复区。`,
    )
    if (!confirmed) return

    setDeletingDoc(doc.id)
    setAdminError('')
    try {
      const payload = await request(`/api/admin/documents/${encodeURIComponent(doc.id)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminToken },
      })
      if (selectedDoc === doc.id) setSelectedDoc(null)
      setToast(`${doc.name} 已移出知识库${payload.document?.recoverable ? '，本地仍可恢复' : ''}`)
      await Promise.all([loadAdminDocuments(adminToken), loadDocuments(), checkService()])
    } catch (error) {
      setAdminError(error.message)
      if (error.status === 401) {
        setAdminToken('')
        setAdminDocuments([])
      }
    } finally {
      setDeletingDoc('')
    }
  }

  async function renameAdminDocument(doc) {
    if (renamingDoc || deletingDoc) return
    const nextName = window.prompt('输入新的文件名（不需要填写扩展名）', doc.name)?.trim()
    if (!nextName || nextName === doc.name) return

    setRenamingDoc(doc.id)
    setAdminError('')
    try {
      const payload = await request(`/api/admin/documents/${encodeURIComponent(doc.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({ name: nextName }),
      })
      setToast(`${payload.document?.name || nextName} 已重命名`)
      await Promise.all([loadAdminDocuments(adminToken), loadDocuments(), checkService()])
    } catch (error) {
      setAdminError(error.message)
      if (error.status === 401) {
        setAdminToken('')
        setAdminDocuments([])
      }
    } finally {
      setRenamingDoc('')
    }
  }

  function logoutAdmin() {
    setAdminToken('')
    setAdminDocuments([])
    setAdminError('')
  }

  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined) return '源文件未找到'
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const online = health.status === 'ok'
  const activeDocName = documents.find((doc) => doc.id === selectedDoc)?.name

  return (
    <main className="page-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <span className="brand-mark circuit-mark" aria-hidden="true">
            <span className="circuit-core"><i /></span>
            <span className="circuit-node node-top" />
            <span className="circuit-node node-right" />
            <span className="circuit-node node-bottom" />
            <span className="circuit-node node-left" />
          </span>
          <div><strong>芯问</strong><small>Chip Manual AI</small></div>
        </div>

        <button className="new-chat" type="button" onClick={startNewChat} disabled={asking}>
          <span aria-hidden="true">＋</span>新建对话
        </button>

        <section className="chat-history" aria-labelledby="history-title">
          <div className="section-heading"><p id="history-title">最近对话</p><span>{chatHistory.length}</span></div>
          <div className="history-list">
            {chatHistory.map((chat) => (
              <div className={`history-item ${activeChatId === chat.id ? 'active' : ''}`} key={chat.id}>
                <button className="history-main" type="button" disabled={asking} onClick={() => openSavedChat(chat)} title={chat.title}>
                  <span className="history-bubble" aria-hidden="true">••</span>
                  <span><strong>{chat.title}</strong><small>{formatChatTime(chat.updatedAt)}</small></span>
                </button>
                <div className="history-actions">
                  <button type="button" disabled={asking} aria-label={`重命名 ${chat.title}`} title="重命名" onClick={(event) => renameSavedChat(event, chat)}>✎</button>
                  <button type="button" disabled={asking} aria-label={`删除 ${chat.title}`} title="删除" onClick={(event) => deleteSavedChat(event, chat)}>×</button>
                </div>
              </div>
            ))}
            {!chatHistory.length && <div className="empty-history">你的对话只保存在当前浏览器</div>}
          </div>
        </section>

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

        <p className="developer-credit">Developed by <strong>ZTX</strong></p>

        <div className={`local-card ${online ? 'online' : health.status}`}>
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{online ? '问答服务已连接' : health.status === 'checking' ? '正在连接' : '问答服务未连接'}</strong>
            <small>{online ? (health.generator === 'ollama' ? `${health.model} 回答` : '资料检索模式') : '点击右侧进行设置'}</small>
          </div>
          <button type="button" aria-label="连接设置" onClick={() => setSettingsOpen(true)}>•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">EMBEDDED KNOWLEDGE ASSISTANT</p><h1>让芯片手册，<em>开口回答。</em></h1><div className="rag-highlight"><span>核心特色 · RAG</span><strong>检索增强生成（Retrieval-Augmented Generation，RAG）技术</strong></div></div>
          <div className="topbar-actions">
            <button className={`admin-entry ${adminToken ? 'verified' : ''}`} type="button" onClick={openAdminPanel}>
              <span aria-hidden="true">◇</span>{adminToken ? '管理知识库' : '管理员验证'}
            </button>
            <button className="round-button" type="button" aria-label="网站设置" onClick={() => setSettingsOpen(true)}>⚙</button>
          </div>
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
            <span>{uploading ? '大型参考手册可能需要几分钟' : `公开体验 · 仅限 PDF · 不超过 ${PUBLIC_UPLOAD_LIMIT_MB} MB · 请勿上传敏感资料`}</span>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={(event) => uploadFile(event.target.files?.[0])} hidden />
          <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '处理中' : '选择文件'}</button>
        </section>

        <section className="chat-card">
          <div className="chat-head">
            <div className="ai-avatar" aria-hidden="true">AI</div>
            <div className="chat-head-copy">
              <div className="chat-title-line"><strong>{assistantMode === 'engineering' ? '工程助手' : '手册问答'}</strong><button className="info-button" type="button" aria-label="查看检索规则" onClick={() => setRetrievalInfoOpen(true)}>检索规则&nbsp;?</button></div>
              <div className="mode-switch" role="tablist" aria-label="回答模式">
                <button type="button" role="tab" aria-selected={assistantMode === 'qa'} className={assistantMode === 'qa' ? 'active' : ''} disabled={asking} onClick={() => changeAssistantMode('qa')}>手册问答</button>
                <button type="button" role="tab" aria-selected={assistantMode === 'engineering'} className={assistantMode === 'engineering' ? 'active' : ''} disabled={asking} onClick={() => changeAssistantMode('engineering')}>工程助手</button>
              </div>
              <span><i /> {activeDocName ? `当前只查：${activeDocName}` : assistantMode === 'engineering' ? '基于手册生成接线与配置方案' : '依据全部已索引资料回答'}</span>
            </div>
            {activeDocName && <button className="clear-filter" type="button" onClick={() => setSelectedDoc(null)}>取消限定</button>}
          </div>

          <div className="conversation" ref={conversationRef} aria-live="polite">
            {!messages.length && (
              <>
                <div className="message ai-message">
                  <p>你好，我已经连接到当前的芯片资料库。</p>
                  <p>{assistantMode === 'engineering' ? '工程助手会把问题整理成接线、元件、配置和风险清单，并标出手册页码。' : '你可以问寄存器、引脚、时序或板级连接问题，我会同时给出手册页码。'}</p>
                </div>
                <div className="suggestions" aria-label="示例问题">
                  {suggestions.map((item) => <button type="button" key={item} onClick={() => askQuestion(item)}>{item}</button>)}
                </div>
              </>
            )}

            {messages.map((message) => {
              const evidence = splitEvidenceSources(message.content, message.sources || [])
              return (
              <article className={`message-row ${message.role}`} key={message.id}>
                <div className={`message ${message.error ? 'error-message' : ''} ${message.role === 'assistant' && !message.error ? 'markdown-message' : ''}`}>
                  {message.role === 'assistant' && !message.error ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkMath, remarkGfm]}
                      rehypePlugins={[rehypeKatex]}
                      components={{ a: MarkdownEvidenceLink }}
                    >
                      {normalizeMarkdownTables(linkEvidenceCitations(message.content, message.id, message.sources))}
                    </ReactMarkdown>
                  ) : message.content}
                </div>
                  {!!message.sources?.length && (
                  <details className="source-panel">
                    <summary>
                      已引用依据 {evidence.citedCount} 条
                      {evidence.relatedCount > 0 && <span className="source-pages"> · 其他相关检索结果 {evidence.relatedCount} 条</span>}
                      <span className="source-pages">{evidencePageSummary(message.sources)}</span>
                    </summary>
                    <div className="source-list">
                      {evidence.items.map(({ source, index, cited }, orderedIndex, orderedItems) => (
                        <div className="source-entry" key={`${source.doc_id}-${source.page}-${index}`}>
                          {(!orderedIndex || cited !== orderedItems[orderedIndex - 1].cited) && (
                            <div className="source-group-title">{cited ? '答案实际引用' : '其他相关检索结果'}</div>
                          )}
                        <details id={`evidence-${message.id}-${index + 1}`} className={`source-item ${cited ? 'source-used' : 'source-related'}`}>
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
                            <p>{cleanPdfText(source.content) || '这条依据暂时没有可显示的原文。'}</p>
                          </div>
                        </details>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </article>
              )
            })}

            {asking && <div className="thinking" aria-label={`正在查询手册，已用时 ${searchElapsed} 秒`}><span /><span /><span />正在查手册 · 已用时 {searchElapsed} 秒</div>}
          </div>

          <form className="composer" onSubmit={submitQuestion}>
            <textarea
              aria-label="输入问题"
              rows="1"
              placeholder={online ? '问一个芯片问题…' : '问答服务暂时离线…'}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              disabled={asking}
            />
            <div className="composer-foot"><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" disabled={!question.trim() || asking} aria-label="发送问题">↑</button></div>
          </form>
        </section>
      </section>

      {retrievalInfoOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRetrievalInfoOpen(false)}>
          <section className="settings-modal retrieval-modal" role="dialog" aria-modal="true" aria-labelledby="retrieval-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><p>HOW RAG WORKS</p><h2 id="retrieval-title">检索规则说明</h2></div>
              <button type="button" aria-label="关闭检索规则" onClick={() => setRetrievalInfoOpen(false)}>×</button>
            </div>
            <ol className="retrieval-steps">
              <li><strong>理解问题</strong><span>识别芯片型号、外设、寄存器和关键词；连续追问时会参考前面的对话。</span></li>
              <li><strong>混合检索</strong><span>同时使用向量检索和关键词检索，在已索引的芯片手册中查找相关片段。</span></li>
              <li><strong>相关性排序</strong><span>综合语义相似度、关键词命中、寄存器名称和正文/表格类型，选出最相关的资料。</span></li>
              <li><strong>生成回答</strong><span>把检索到的手册片段交给本地模型组织答案，并标出对应文档和页码。</span></li>
            </ol>
            <p className="settings-tip">RAG 的全称是 Retrieval-Augmented Generation，即“检索增强生成”。答案只应以已检索到的手册内容为依据；切换到工程助手后，会在同样的依据上进一步整理接线、配置和风险。</p>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <form className="settings-modal" onSubmit={saveSettings} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><p>服务连接</p><h2>连接到芯问后端</h2></div>
              <button type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <label>服务地址<input value={draftApiUrl} onChange={(event) => setDraftApiUrl(event.target.value)} placeholder="https://你的安全通道地址" /></label>
            <label>连接口令（可选）<input type="password" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} placeholder="公开体验可以留空" /></label>
            <p className="settings-tip">网站会自动连接公开问答服务，只有维护时才需要修改这里。</p>
            <button className="save-settings" type="submit">保存并重新连接</button>
          </form>
        </div>
      )}

      {adminOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAdminOpen(false)}>
          <section className="settings-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p>{adminToken ? 'ADMIN CONSOLE' : 'SECURE ACCESS'}</p>
                <h2 id="admin-title">{adminToken ? '知识库管理' : '管理员验证'}</h2>
              </div>
              <button type="button" aria-label="关闭管理员面板" onClick={() => setAdminOpen(false)}>×</button>
            </div>

            {!adminToken ? (
              <form className="admin-login" onSubmit={loginAdmin}>
                <div className="admin-lock" aria-hidden="true"><span>◇</span></div>
                <p>验证通过后，可以远程移除知识库中的文件。</p>
                <label>
                  管理员密码
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="输入管理员密码"
                    autoComplete="current-password"
                    autoFocus
                  />
                </label>
                {adminError && <div className="admin-error" role="alert">{adminError}</div>}
                <button className="save-settings" type="submit" disabled={!adminPassword || adminLoading}>
                  {adminLoading ? '正在验证…' : '验证并进入'}
                </button>
                <small>连续输错5次将暂时锁定10分钟。</small>
              </form>
            ) : (
              <div className="admin-console">
                <div className="admin-console-head">
                  <div><i aria-hidden="true" />身份已验证 · 共 {adminDocuments.length} 份文档</div>
                  <button type="button" onClick={logoutAdmin}>退出管理</button>
                </div>

                {adminError && <div className="admin-error" role="alert">{adminError}</div>}
                <div className="admin-doc-list">
                  {adminLoading && !adminDocuments.length && <div className="admin-empty">正在读取知识库…</div>}
                  {!adminLoading && !adminDocuments.length && <div className="admin-empty">知识库中没有文件</div>}
                  {adminDocuments.map((doc) => (
                    <div className="admin-doc-row" key={doc.id}>
                      <span className="admin-file-icon" aria-hidden="true">PDF</span>
                      <div className="admin-doc-copy">
                        <strong>{doc.name}</strong>
                        <small>{doc.filename || doc.name} · {doc.pages} 页 · {formatFileSize(doc.size_bytes)}</small>
                        <span>{doc.source === 'uploaded' ? '用户上传' : '预置资料'}</span>
                      </div>
                      <div className="admin-doc-actions">
                        <button
                          className="rename-doc"
                          type="button"
                          disabled={Boolean(deletingDoc || renamingDoc)}
                          onClick={() => renameAdminDocument(doc)}
                        >
                          {renamingDoc === doc.id ? '处理中…' : '重命名'}
                        </button>
                        <button
                          className="delete-doc"
                          type="button"
                          disabled={Boolean(deletingDoc || renamingDoc)}
                          onClick={() => deleteAdminDocument(doc)}
                        >
                          {deletingDoc === doc.id ? '处理中…' : '移出'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="admin-recovery-tip">移出的文件会保存在本机可恢复区，不会立即永久删除。</p>
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  )
}

export default App
