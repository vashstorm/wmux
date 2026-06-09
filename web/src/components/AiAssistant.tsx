import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import MicIcon from "@mui/icons-material/Mic"
import MicOffIcon from "@mui/icons-material/MicOff"
import StopCircleIcon from "@mui/icons-material/StopCircle"
import VolumeOffIcon from "@mui/icons-material/VolumeOff"
import VolumeUpIcon from "@mui/icons-material/VolumeUp"
import CloseIcon from "@mui/icons-material/Close"
import AddIcon from "@mui/icons-material/Add"
import SendIcon from "@mui/icons-material/Send"
import { getRuntimeFlags } from "../api/runtime.js"
import { OmniIpc } from "../api/voiceIpc.js"
import { AudioPipeline } from "../api/audioPipeline.js"
import type { OmniServerEvent, VoiceSessionContextMessage } from "../api/voiceTypes.js"
import {
  isVoiceAudioDeltaEvent,
  isVoiceTranscriptDeltaEvent,
  isVoiceTranscriptDoneEvent,
  isVoiceTranscriptCorrectedEvent,
  isVoiceIntentReceivedEvent,
  isVoiceActionResultEvent,
  isVoiceErrorEvent,
  isVoiceConnectedEvent,
  isVoiceAssistantMessageEvent,
  isVoiceAssistantDeltaEvent,
  isVoiceTokenUsageEvent,
} from "../api/voiceTypes.js"
import { useAppState } from "../state/store.js"
import {
  getConfig,
  getOmniHistory,
  clearOmniHistory,
  createSession,
  getProject,
  killSession,
  listConnections,
  listPanes,
  listProjects,
  listSessions,
  listWindows,
  renameSession,
  createWindow,
  killWindow,
  renameWindow,
  splitPane,
  killPane,
  sendKeysToPane,
  capturePane,
  clearPane,
  createProject,
  updateProject,
  deleteProject,
  launchProject,
  syncProjectFromTmux,
  generateProjectAiHtml,
  analyzeSession,
  listAiStats,
  cleanupAiStats,
  listAiLogs,
  clearAiLogs,
  fetchHealth,
  getConnectionHealth,
  updateConfig,
  type AppConfig,
  type OmniConversationMessage,
  type PaneInfo,
  type Project,
  type WindowInfo,
} from "../api/client.js"
import {
  LAUNCHER_POS_CHANGE_EVENT,
  clampAssistantPos,
  scalePosOnResize,
  dialogPosFromLauncher,
  launcherPosFromDialog,
  loadLauncherPos,
  saveLauncherPos,
  type AssistantPos,
} from "./AiAssistantUtils.js"

const LEVEL_SEGMENTS = 12
const AUDIO_PIPELINE_CONFIG = {
  sampleRateInput: 16000,
  sampleRateOutput: 24000,
  vadEnabled: false,
  vadThreshold: 0,
}
const ASSISTANT_SIZE_STORAGE_KEY = "wmux-ai-assistant-size"
const DEFAULT_ASSISTANT_SIZE = { width: 380, height: 520 }
const MIN_ASSISTANT_SIZE = { width: 320, height: 360 }
const VIEWPORT_MARGIN_PX = 16

type AssistantSize = typeof DEFAULT_ASSISTANT_SIZE
type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  skillTokens?: number
  cacheReadTokens?: number
}
type TokenUsageStats = {
  last: TokenUsage | null
  total: TokenUsage
}
type ResizeStart = {
  pointerId: number | "mouse"
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  startPos: AssistantPos
  direction: "width" | "height" | "both"
}
type DragStart = {
  pointerId: number | "mouse"
  originX: number
  originY: number
  baseX: number
  baseY: number
}

function clampAssistantSize(size: AssistantSize): AssistantSize {
  if (typeof window === "undefined") return size
  const maxWidth = Math.max(MIN_ASSISTANT_SIZE.width, window.innerWidth - VIEWPORT_MARGIN_PX * 2)
  const maxHeight = Math.max(MIN_ASSISTANT_SIZE.height, window.innerHeight - VIEWPORT_MARGIN_PX * 2)
  return {
    width: Math.min(maxWidth, Math.max(MIN_ASSISTANT_SIZE.width, Math.round(size.width))),
    height: Math.min(maxHeight, Math.max(MIN_ASSISTANT_SIZE.height, Math.round(size.height))),
  }
}

function loadAssistantSize(): AssistantSize {
  try {
    const raw = localStorage.getItem(ASSISTANT_SIZE_STORAGE_KEY)
    if (!raw) return DEFAULT_ASSISTANT_SIZE
    const parsed = JSON.parse(raw) as Partial<AssistantSize>
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
      return DEFAULT_ASSISTANT_SIZE
    }
    return clampAssistantSize({ width: parsed.width, height: parsed.height })
  } catch {
    return DEFAULT_ASSISTANT_SIZE
  }
}

function saveAssistantSize(size: AssistantSize): void {
  try {
    localStorage.setItem(ASSISTANT_SIZE_STORAGE_KEY, JSON.stringify(size))
  } catch {}
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h}:${m < 10 ? "0" : ""}${m}`
}

function formatRole(role: string): string {
  return role === "user" ? "You" : "AI"
}

function emptyTokenUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, skillTokens: 0, cacheReadTokens: 0 }
}

function addTokenUsage(total: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    totalTokens: total.totalTokens + next.totalTokens,
    skillTokens: (total.skillTokens ?? 0) + (next.skillTokens ?? 0),
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
  }
}

function displayInputTokens(usage: TokenUsage): number {
  return Math.max(0, usage.inputTokens - (usage.skillTokens ?? 0))
}

function percentOfTotal(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0
}

function formatTokenCount(count: number): string {
  return new Intl.NumberFormat().format(count)
}

function omniComposerText(status: string): string {
  switch (status) {
    case "connecting":
      return "Connecting to AI..."
    case "listening":
      return "Listening..."
    case "processing":
      return "AI is thinking..."
    case "speaking":
      return "AI is speaking..."
    case "confirming":
      return "Waiting for confirmation..."
    default:
      return "Voice message to AI"
  }
}

function createAudioPipeline(): AudioPipeline {
  return new AudioPipeline(AUDIO_PIPELINE_CONFIG)
}

type VoiceIntentParams = Record<string, unknown>
type VoiceToolResultPayload = { output?: unknown; error?: string }

function stringParam(params: VoiceIntentParams, fields: string[]): string | null {
  for (const field of fields) {
    const value = params[field]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function objectParam(params: VoiceIntentParams, field: string): VoiceIntentParams | null {
  const value = params[field]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as VoiceIntentParams)
    : null
}

function matchesText(value: string, query: string): boolean {
  return value.toLowerCase() === query.toLowerCase()
}

function parseChineseInteger(value: string): number | null {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (value === "十") return 10
  const teenMatch = value.match(/^十([一二两三四五六七八九])$/)
  if (teenMatch?.[1]) return 10 + digits[teenMatch[1]]!
  const tensMatch = value.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/)
  if (tensMatch?.[1]) {
    return digits[tensMatch[1]]! * 10 + (tensMatch[2] ? digits[tensMatch[2]]! : 0)
  }
  return digits[value] ?? null
}

function parseOrdinal(value: string | null): number | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  const numeric = normalized.match(/^第?\s*(\d+)\s*(?:个|号|#|st|nd|rd|th)?$/)
  if (numeric?.[1]) {
    const parsed = Number(numeric[1])
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  const chinese = normalized.match(/^第?\s*([一二两三四五六七八九十]+)\s*(?:个|号)?$/)
  if (chinese?.[1]) {
    const parsed = parseChineseInteger(chinese[1])
    return parsed && parsed > 0 ? parsed : null
  }

  return null
}

function sortWindowsForVoiceSelection(windows: WindowInfo[]): WindowInfo[] {
  return [...windows].sort((a, b) => a.Index - b.Index)
}

function findWindowByVoiceTarget(
  windows: WindowInfo[],
  query: string | null,
  ordinal: number | null = null,
  fallbackWhenQueryMisses = true,
): WindowInfo | undefined {
  const ordered = sortWindowsForVoiceSelection(windows)
  if (ordinal !== null) {
    return ordered[ordinal - 1]
  }
  if (!query) return windows.find((windowInfo) => windowInfo.Active) ?? ordered[0]

  const trimmedQuery = query.trim()
  const idOrNameMatch = windows.find(
    (windowInfo) =>
      windowInfo.ID === trimmedQuery ||
      matchesText(windowInfo.Name, trimmedQuery),
  )
  if (idOrNameMatch) return idOrNameMatch

  const queryOrdinal = parseOrdinal(trimmedQuery)
  if (queryOrdinal !== null) {
    return ordered[queryOrdinal - 1]
  }

  const indexMatch = windows.find((windowInfo) => String(windowInfo.Index) === trimmedQuery)
  if (indexMatch) return indexMatch

  if (!fallbackWhenQueryMisses) return undefined
  return windows.find((windowInfo) => windowInfo.Active) ?? ordered[0]
}

function findWindow(windows: WindowInfo[], query: string | null): WindowInfo | undefined {
  return findWindowByVoiceTarget(windows, query)
}

function findPane(panes: PaneInfo[], query: string | null): PaneInfo | undefined {
  if (!query) return panes.find((paneInfo) => paneInfo.Active) ?? panes[0]
  return (
    panes.find((paneInfo) => paneInfo.ID === query || String(paneInfo.Index) === query) ??
    panes.find((paneInfo) => paneInfo.Active) ??
    panes[0]
  )
}

function findProject(projects: Project[], params: VoiceIntentParams): Project | undefined {
  const projectId = stringParam(params, ["project_id", "projectId"])
  if (projectId) {
    return projects.find((project) => project.id === projectId)
  }

  const projectName = stringParam(params, ["project_name", "projectName", "name"])
  if (projectName) {
    return projects.find((project) => matchesText(project.name, projectName))
  }

  const sessionName = stringParam(params, ["session", "session_name", "sessionName"])
  if (sessionName) {
    return projects.find(
      (project) => project.sessionName === sessionName || matchesText(project.name, sessionName),
    )
  }

  return undefined
}

function emitSidebarNavigation(route: string): void {
  window.dispatchEvent(new CustomEvent("wmux:navigate-sidebar", { detail: { route } }))
}

function compactSessionForTool(session: { name?: string; attached?: boolean; windowCount?: number }) {
  return {
    name: session.name ?? "",
    attached: session.attached ?? false,
    windowCount: session.windowCount ?? 0,
  }
}

function compactOperationForTool(operation: unknown): unknown {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return operation
  }
  const record = operation as Record<string, unknown>
  return {
    targetName: record.targetName,
    operation: record.operation,
    mode: record.mode,
    status: record.status,
  }
}

function isDashScopeSettingsError(error: Error): boolean {
  return (
    error.message.includes("DashScope") ||
    error.message.includes("API key") ||
    error.message.includes("Authorization") ||
    error.message.includes("endpoint region") ||
    error.message.includes("connection failed")
  )
}

function voiceErrorMessage(error: Error): string {
  if (isDashScopeSettingsError(error)) {
    return error.message
  }
  return error.message || "Connection failed"
}

function normalizeAgentPrompt(prompt: string): string {
  return prompt.replace(/\s*\r?\n\s*/g, " ").trim()
}

function shellDoubleQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`
}

function parseVoiceConfirmation(text: string): "confirm" | "cancel" | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
  const compact = normalized.replace(/\s/g, "")
  if (!normalized && !compact) return null

  const exactCancel = new Set([
    "cancel",
    "no",
    "stop",
    "abort",
    "reject",
    "never mind",
    "nevermind",
    "取消",
    "不",
    "不要",
    "停止",
    "算了",
    "别",
    "不行",
    "否",
    "拒绝",
    "不确认",
  ])
  const exactConfirm = new Set([
    "confirm",
    "yes",
    "ok",
    "okay",
    "sure",
    "do it",
    "proceed",
    "approve",
    "go ahead",
    "确认",
    "确定",
    "可以",
    "好",
    "好的",
    "是",
    "是的",
    "执行",
    "同意",
    "继续",
  ])

  if (exactCancel.has(normalized) || exactCancel.has(compact)) return "cancel"
  if (exactConfirm.has(normalized) || exactConfirm.has(compact)) return "confirm"

  const cancelPhrases = ["cancel", "abort", "reject", "停止", "取消", "算了", "不要", "不行", "拒绝", "不确认"]
  if (cancelPhrases.some((phrase) => normalized.includes(phrase) || compact.includes(phrase))) {
    return "cancel"
  }

  const confirmPhrases = ["confirm", "proceed", "approve", "go ahead", "do it", "确认", "确定", "可以", "执行", "同意", "继续"]
  if (confirmPhrases.some((phrase) => normalized.includes(phrase) || compact.includes(phrase))) {
    return "confirm"
  }

  return null
}

async function openMicrophonePermissions(): Promise<void> {
  // No-op: wmux doesn't have Electron-specific microphone permissions
}

async function requestMicrophoneAccess(): Promise<boolean | null> {
  // No-op: wmux doesn't have Electron-specific microphone permissions
  return null
}

export function AiAssistant() {
  const {
    omniStatus,
    omniTranscript,
    omniPendingConfirmation,
    omniError,
    setOmniStatus,
    appendVoiceTranscript,
    setOmniTranscript,
    setOmniConfirmation,
    setOmniError,
    setError,
    setShowSettingsPanel,
    setShowNewConnectionForm,
    setShowErrorLogsPanel,
    setShowAiAssistant,
    connections,
    selectedTargetName,
    selectedPane,
    setSelectedTargetName,
    setSessions,
    setWindows,
    setPanes,
    setSelectedPane,
    setSelectedProject,
  } = useAppState()

  const audioLevel = useRef(0)
  const [audioBars, setAudioBars] = useState<boolean[]>(new Array(LEVEL_SEGMENTS).fill(false))
  const wsRef = useRef<OmniIpc | null>(null)
  const pipelineRef = useRef<AudioPipeline | null>(null)
  const wsConnectingRef = useRef(false)
  const omniStatusRef = useRef(omniStatus)
  const [wsConnecting, setWsConnecting] = useState(false)
  const [micCapturing, setMicCapturing] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("omni-volume")
    return saved !== null ? Number(saved) : 1.0
  })
  const [micDisabled, setMicDisabled] = useState(false)
  const [micAvailable, setMicAvailable] = useState(() => getRuntimeFlags().omniAvailable)
  const [history, setHistory] = useState<OmniConversationMessage[]>([])
  const [assistantDraft, setAssistantDraft] = useState("")
  const [tokenUsage, setTokenUsage] = useState<TokenUsageStats>(() => ({
    last: null,
    total: emptyTokenUsage(),
  }))
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inputText, setInputText] = useState("")
  const [assistantSize, setAssistantSize] = useState(loadAssistantSize)
  const [assistantPos, setAssistantPos] = useState<AssistantPos>(() =>
    dialogPosFromLauncher(loadLauncherPos(), loadAssistantSize()),
  )
  const assistantSizeRef = useRef(assistantSize)
  const assistantPosRef = useRef(assistantPos)
  const chatRef = useRef<HTMLDivElement | null>(null)
  const assistantDraftRef = useRef("")
  const audioMutedRef = useRef(false)
  const omniPendingConfirmationRef = useRef(omniPendingConfirmation)
  const lastSuccessfulConfirmationAtRef = useRef(0)
  const suppressAssistantOutputRef = useRef(false)
  const resizeStartRef = useRef<ResizeStart | null>(null)
  const dragStartRef = useRef<DragStart | null>(null)

  const [showTokenPopover, setShowTokenPopover] = useState(false)
  const [pulseActive, setPulseActive] = useState(false)
  const tokenMeterContainerRef = useRef<HTMLDivElement | null>(null)
  const [showVolumePopover, setShowVolumePopover] = useState(false)
  const volumePopoverRef = useRef<HTMLDivElement | null>(null)

  const prevTotalRef = useRef(0)
  const omniTranscriptRef = useRef(omniTranscript)
  const pendingTranscriptCorrectionRef = useRef<string | null>(null)
  const lastFinalTranscriptAtRef = useRef(0)

  useEffect(() => {
    const handleLauncherPosChange = (event: Event) => {
      const nextLauncherPos = (event as CustomEvent<AssistantPos>).detail
      if (
        !nextLauncherPos ||
        typeof nextLauncherPos.x !== "number" ||
        typeof nextLauncherPos.y !== "number"
      ) {
        return
      }
      const nextPos = dialogPosFromLauncher(nextLauncherPos, assistantSizeRef.current)
      assistantPosRef.current = nextPos
      setAssistantPos(nextPos)
    }
    window.addEventListener(LAUNCHER_POS_CHANGE_EVENT, handleLauncherPosChange)
    return () => window.removeEventListener(LAUNCHER_POS_CHANGE_EVENT, handleLauncherPosChange)
  }, [])

  useEffect(() => {
    const nextTotal = tokenUsage.total.totalTokens
    if (nextTotal > prevTotalRef.current && prevTotalRef.current > 0) {
      setPulseActive(true)
      const timer = setTimeout(() => setPulseActive(false), 800)
      return () => clearTimeout(timer)
    }
    prevTotalRef.current = nextTotal
  }, [tokenUsage.total.totalTokens])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        showTokenPopover &&
        tokenMeterContainerRef.current &&
        !tokenMeterContainerRef.current.contains(e.target as Node)
      ) {
        setShowTokenPopover(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [showTokenPopover])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showTokenPopover) {
        setShowTokenPopover(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showTokenPopover])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (
        showVolumePopover &&
        volumePopoverRef.current &&
        !volumePopoverRef.current.contains(e.target as Node) &&
        !target?.closest(".voice-btn--audio") &&
        !target?.closest(".voice-btn--muted")
      ) {
        setShowVolumePopover(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [showVolumePopover])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showVolumePopover) {
        setShowVolumePopover(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [showVolumePopover])

  const buildSessionContextMessage = useCallback((): VoiceSessionContextMessage | null => {
    const targetName = selectedPane?.targetName ?? selectedTargetName
    if (!targetName) return null

    const connection = connections.find((conn) => conn.targetName === targetName)
    return {
      type: "session_context",
      target: {
        targetName,
        session: selectedPane?.session,
        window: selectedPane?.window,
        pane: selectedPane?.pane,
      },
      connectionType: connection?.type,
    }
  }, [connections, selectedPane, selectedTargetName])

  const sendSessionContext = useCallback(
    (ws: OmniIpc) => {
      const context = buildSessionContextMessage()
      if (context) {
        ws.send(context)
      }
      return context
    },
    [buildSessionContextMessage],
  )

  useEffect(() => {
    omniStatusRef.current = omniStatus
  }, [omniStatus])
  useEffect(() => {
    omniTranscriptRef.current = omniTranscript
  }, [omniTranscript])
  useEffect(() => {
    audioMutedRef.current = audioMuted
  }, [audioMuted])
  useEffect(() => {
    omniPendingConfirmationRef.current = omniPendingConfirmation
  }, [omniPendingConfirmation])
  useEffect(() => {
    let cancelled = false
    const loadMicState = async () => {
      try {
        const cfg = await getConfig()
        if (!cancelled) {
          setMicDisabled(cfg.omni?.microphoneDisabled ?? false)
          setMicAvailable(getRuntimeFlags().omniAvailable)
          setOmniStatus(cfg.omni?.enabled ? "idle" : "disabled")
        }
      } catch {
        if (!cancelled) {
          setMicAvailable(getRuntimeFlags().omniAvailable)
        }
      }
    }
    void loadMicState()
    return () => {
      cancelled = true
    }
  }, [setOmniStatus])

  useEffect(() => {
    let cancelled = false
    const loadHistory = async () => {
      setHistoryLoading(true)
      try {
        const messages = await getOmniHistory({ conversationId: "default", limit: 20 })
        if (!cancelled) {
          setHistory(messages)
        }
      } catch {
        // History fetch failed — show empty
      } finally {
        if (!cancelled) {
          setHistoryLoading(false)
        }
      }
    }
    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [])

  const handleNewChat = useCallback(async () => {
    try {
      await clearOmniHistory()
    } catch {}
    pipelineRef.current?.stopPlayback()
    pipelineRef.current?.stopCapture()
    wsRef.current?.close()
    wsRef.current = null
    wsConnectingRef.current = false
    setWsConnecting(false)
    setMicCapturing(false)
    setAudioBars(new Array(LEVEL_SEGMENTS).fill(false))
    assistantDraftRef.current = ""
    pendingTranscriptCorrectionRef.current = null
    lastFinalTranscriptAtRef.current = 0
    setAssistantDraft("")
    setHistory([])
    setTokenUsage({ last: null, total: emptyTokenUsage() })
    if (omniStatusRef.current !== "disabled") {
      setOmniStatus("idle")
    }
  }, [setOmniStatus])

  const appendAssistantDraft = useCallback((text: string) => {
    assistantDraftRef.current += text
    setAssistantDraft(assistantDraftRef.current)
  }, [])

  const clearAssistantDraft = useCallback(() => {
    assistantDraftRef.current = ""
    setAssistantDraft("")
  }, [])

  const scrollChatToBottom = useCallback(() => {
    const chat = chatRef.current
    if (!chat) return
    chat.scrollTop = chat.scrollHeight
  }, [])

  const startAssistantResize = useCallback(
    (
      clientX: number,
      clientY: number,
      pointerId: number | "mouse",
      direction: "width" | "height" | "both",
    ) => {
      resizeStartRef.current = {
        pointerId,
        startX: clientX,
        startY: clientY,
        startWidth: assistantSize.width,
        startHeight: assistantSize.height,
        startPos: assistantPos,
        direction,
      }
      const cursorMap = {
        both: "nwse-resize",
        width: "ew-resize",
        height: "ns-resize",
      }
      document.body.style.cursor = cursorMap[direction]
      document.body.style.userSelect = "none"
    },
    [assistantSize, assistantPos],
  )

  const updateAssistantResize = useCallback(
    (clientX: number, clientY: number, pointerId: number | "mouse") => {
      const start = resizeStartRef.current
      if (!start || start.pointerId !== pointerId) return
      const deltaX = start.startX - clientX
      const deltaY = start.startY - clientY
      const nextSize = clampAssistantSize({
        width: start.direction === "height" ? start.startWidth : start.startWidth + deltaX,
        height: start.direction === "width" ? start.startHeight : start.startHeight + deltaY,
      })
      
      const actualDeltaX = nextSize.width - start.startWidth
      const actualDeltaY = nextSize.height - start.startHeight
      
      const nextPos = clampAssistantPos(
        {
          x: start.direction === "height" ? start.startPos.x : start.startPos.x - actualDeltaX,
          y: start.direction === "width" ? start.startPos.y : start.startPos.y - actualDeltaY,
        },
        nextSize,
      )
      
      assistantSizeRef.current = nextSize
      assistantPosRef.current = nextPos
      setAssistantSize(nextSize)
      setAssistantPos(nextPos)
    },
    [],
  )

  const finishAssistantResize = useCallback((pointerId: number | "mouse") => {
    const start = resizeStartRef.current
    if (!start || start.pointerId !== pointerId) return
    resizeStartRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    setAssistantSize((current) => {
      saveAssistantSize(current)
      saveLauncherPos(launcherPosFromDialog(assistantPosRef.current, current))
      return current
    })
  }, [])

  const openWorkspaceTarget = useCallback(
    async (params: VoiceIntentParams) => {
      const targetName =
        stringParam(params, ["target_name", "targetName"]) ??
        selectedPane?.targetName ??
        selectedTargetName
      const sessionName =
        stringParam(params, ["session", "session_name", "sessionName"]) ?? selectedPane?.session

      if (!targetName || !sessionName) {
        setError({
          code: "voice_navigation_failed",
          message: "Target and session are required to open a workspace item",
        })
        return
      }

      const windowQuery = stringParam(params, [
        "window",
        "window_name",
        "windowName",
        "window_id",
        "windowId",
        "window_index",
        "windowIndex",
        "index",
        "position",
        "ordinal",
      ])
      const windowOrdinal =
        stringParam(params, ["window_index", "windowIndex", "index", "position", "ordinal"])
          ? parseOrdinal(
              stringParam(params, ["window_index", "windowIndex", "index", "position", "ordinal"]),
            )
          : windowQuery && /^第/.test(windowQuery.trim())
            ? parseOrdinal(windowQuery)
            : null
      const paneQuery = stringParam(params, ["pane", "pane_index", "paneIndex"])

      try {
        setSelectedTargetName(targetName)

        const sessionsResponse = await listSessions(targetName)
        setSessions(targetName, sessionsResponse.data ?? [])

        const windowsResponse = await listWindows(targetName, sessionName)
        const windows = windowsResponse.data ?? []
        setWindows(targetName, sessionName, windows)

        const selectedWindow = findWindowByVoiceTarget(windows, windowQuery, windowOrdinal)
        if (!selectedWindow) {
          setSelectedPane({ targetName, session: sessionName })
          return { targetName, session: sessionName }
        }

        const panesResponse = await listPanes(targetName, sessionName, selectedWindow.ID)
        const panes = panesResponse.data ?? []
        setPanes(targetName, sessionName, selectedWindow.ID, panes)

        const selectedPaneInfo = findPane(panes, paneQuery)
        const nextSelection = {
          targetName,
          session: sessionName,
          window: selectedWindow.ID,
          pane: selectedPaneInfo?.ID,
        }
        setSelectedPane({
          ...nextSelection,
        })
        return {
          targetName,
          session: sessionName,
          window: selectedWindow.ID,
          pane: selectedPaneInfo?.ID,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open workspace item"
        setError({
          code: "voice_navigation_failed",
          message,
        })
        throw new Error(message)
      }
    },
    [
      selectedPane,
      selectedTargetName,
      setError,
      setPanes,
      setSelectedPane,
      setSelectedTargetName,
      setSessions,
      setWindows,
    ],
  )

  const openProjectTarget = useCallback(
    async (params: VoiceIntentParams) => {
      const projectId = stringParam(params, ["project_id", "projectId"])

      try {
        const project = projectId
          ? await getProject(projectId)
          : findProject(await listProjects(), params)
        if (project) {
          setSelectedProject(project)
          return { projectId: project.id, name: project.name, path: project.path }
        } else if (
          stringParam(params, [
            "project_name",
            "projectName",
            "name",
            "session",
            "session_name",
            "sessionName",
          ]) !== null
        ) {
          throw new Error("Project not found")
        }
        return { opened: false }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project"
        setError({
          code: "voice_navigation_failed",
          message,
        })
        throw new Error(message)
      }
    },
    [setError, setSelectedProject],
  )

  const executeListSessionsIntent = useCallback(
    async (params: VoiceIntentParams, callId?: string) => {
      const targetName =
        stringParam(params, ["target_name", "targetName"]) ??
        selectedPane?.targetName ??
        selectedTargetName ??
        connections[0]?.targetName ??
        null

      if (!targetName) {
        const message = "Target is required to list sessions"
        setError({ code: "voice_tool_failed", message })
        wsRef.current?.send({
          type: "tool_result",
          skill: "list_sessions",
          callId,
          error: message,
        })
        return
      }

      try {
        const response = await listSessions(targetName)
        const data = response.data ?? []
        setSessions(targetName, data)
        wsRef.current?.send({
          type: "tool_result",
          skill: "list_sessions",
          callId,
          output: {
            targetName,
            count: data.length,
            sessions: data.map(compactSessionForTool),
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to list sessions"
        setError({ code: "voice_tool_failed", message })
        wsRef.current?.send({
          type: "tool_result",
          skill: "list_sessions",
          callId,
          error: message,
        })
      }
    },
    [connections, selectedPane, selectedTargetName, setError, setSessions],
  )

  const resolveIntentTargetName = useCallback(
    (params: VoiceIntentParams): string | null =>
      stringParam(params, ["target_name", "targetName"]) ??
      selectedPane?.targetName ??
      selectedTargetName ??
      connections[0]?.targetName ??
      null,
    [connections, selectedPane, selectedTargetName],
  )

  const resolveIntentSessionName = useCallback(
    (params: VoiceIntentParams): string | null =>
      stringParam(params, ["session", "session_name", "sessionName"]) ??
      selectedPane?.session ??
      null,
    [selectedPane],
  )

  const refreshSessionsForTool = useCallback(
    async (targetName: string) => {
      const response = await listSessions(targetName)
      const data = response.data ?? []
      setSessions(targetName, data)
      return data
    },
    [setSessions],
  )

  const sendToolResult = useCallback(
    (skill: string, callId: string | undefined, result: VoiceToolResultPayload) => {
      wsRef.current?.send({
        type: "tool_result",
        skill,
        callId,
        ...result,
      })
    },
    [],
  )

  const reportIntentPromise = useCallback(
    (skill: string, callId: string | undefined, promise: Promise<unknown>) => {
      void promise
        .then((output) => {
          sendToolResult(skill, callId, { output })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
          sendToolResult(skill, callId, { error: message })
        })
    },
    [sendToolResult],
  )

  const executeSessionMutationIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
      extraOutput?: Record<string, unknown>,
    ) => {
      const targetName = resolveIntentTargetName(params)
      if (!targetName) {
        const message = "Target is required for session operation"
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
        return
      }

      try {
        let operation: unknown
        if (skill === "create_session") {
          const sessionName = stringParam(params, ["session_name", "sessionName", "name", "session"])
          if (!sessionName) {
            throw new Error("Session name is required to create a session")
          }
          operation = await createSession(targetName, sessionName)
        } else if (skill === "rename_session") {
          const sessionName = stringParam(params, ["old_name", "oldName", "session_name", "sessionName", "session"])
          const newName = stringParam(params, ["new_name", "newName", "name"])
          if (!sessionName || !newName) {
            throw new Error("Current session name and new name are required to rename a session")
          }
          operation = await renameSession(targetName, sessionName, newName)
        } else if (skill === "delete_session") {
          const sessionName = stringParam(params, ["session_name", "sessionName", "session", "name"])
          if (!sessionName) {
            throw new Error("Session name is required to delete a session")
          }
          operation = await killSession(targetName, sessionName)
        } else {
          return
        }

        const sessions = await refreshSessionsForTool(targetName)
        sendToolResult(resultSkill, callId, {
          output: {
            ...extraOutput,
            targetName,
            operation: compactOperationForTool(operation),
            count: sessions.length,
            sessions: sessions.map(compactSessionForTool),
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [refreshSessionsForTool, resolveIntentTargetName, sendToolResult, setError],
  )

  const executeBackendRouteIntent = useCallback(
    (params: VoiceIntentParams, callId?: string) => {
      const routeId = stringParam(params, ["route_id", "routeId"])
      const routeParams = objectParam(params, "params") ?? params

      // Delegate mutation intents to the existing handler
      if (routeId === "sessions.create") {
        void executeSessionMutationIntent("create_session", routeParams, callId, "invoke_backend_route", {
          routeId,
        })
        return
      }

      if (routeId === "sessions.rename") {
        void executeSessionMutationIntent("rename_session", routeParams, callId, "invoke_backend_route", {
          routeId,
        })
        return
      }

      if (routeId === "sessions.delete") {
        void executeSessionMutationIntent("delete_session", routeParams, callId, "invoke_backend_route", {
          routeId,
        })
        return
      }

      // Helper to invoke async backend routes and send the result
      const invokeRoute = async () => {
        switch (routeId) {
          case "connections.list": {
            const data = await listConnections()
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "sessions.list": {
            const targetName = resolveIntentTargetName(routeParams)
            if (!targetName) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name is required for sessions.list" })
              return
            }
            const data = await listSessions(targetName)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "sessions.analyze": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            if (!targetName || !sessionName) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name and session_name are required for sessions.analyze" })
              return
            }
            const data = await analyzeSession(targetName, sessionName)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "windows.list": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            if (!targetName || !sessionName) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name and session_name are required for windows.list" })
              return
            }
            const data = await listWindows(targetName, sessionName)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "windows.create": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            if (!targetName || !sessionName) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name and session_name are required for windows.create" })
              return
            }
            const windowName = stringParam(routeParams, ["window_name", "windowName", "name"])
            const data = await createWindow(targetName, sessionName, windowName ?? undefined)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "windows.delete": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            const windowId = stringParam(routeParams, ["window_id", "windowId"])
            if (!targetName || !sessionName || !windowId) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name, session_name, and window_id are required for windows.delete" })
              return
            }
            const data = await killWindow(targetName, sessionName, windowId)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "panes.list": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            const windowId = stringParam(routeParams, ["window_id", "windowId"])
            if (!targetName || !sessionName || !windowId) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name, session_name, and window_id are required for panes.list" })
              return
            }
            const data = await listPanes(targetName, sessionName, windowId)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "panes.split": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            const windowId = stringParam(routeParams, ["window_id", "windowId"])
            const paneId = stringParam(routeParams, ["pane_id", "paneId", "pane"])
            const horizontal = stringParam(routeParams, ["direction", "split_direction", "splitDirection"]) === "horizontal"
            if (!targetName || !sessionName || !windowId || !paneId) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name, session_name, window_id, and pane_id are required for panes.split" })
              return
            }
            const data = await splitPane(targetName, sessionName, windowId, paneId, horizontal)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "panes.delete": {
            const targetName = resolveIntentTargetName(routeParams)
            const sessionName = resolveIntentSessionName(routeParams)
            const windowId = stringParam(routeParams, ["window_id", "windowId"])
            const paneId = stringParam(routeParams, ["pane_id", "paneId", "pane"])
            if (!targetName || !sessionName || !windowId || !paneId) {
              sendToolResult("invoke_backend_route", callId, { error: "target_name, session_name, window_id, and pane_id are required for panes.delete" })
              return
            }
            const data = await killPane(targetName, sessionName, windowId, paneId)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.list": {
            const data = await listProjects()
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.create": {
            const name = stringParam(routeParams, ["name", "project_name", "projectName"])
            if (!name) {
              sendToolResult("invoke_backend_route", callId, { error: "name is required for projects.create" })
              return
            }
            const data = await createProject({
              name,
              path: stringParam(routeParams, ["path"]) ?? undefined,
              description: stringParam(routeParams, ["description"]) ?? undefined,
            })
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.update": {
            const id = stringParam(routeParams, ["id", "project_id", "projectId"])
            if (!id) {
              sendToolResult("invoke_backend_route", callId, { error: "id is required for projects.update" })
              return
            }
            const data = await updateProject(id, {
              name: stringParam(routeParams, ["name", "project_name", "projectName"]) ?? undefined,
              path: stringParam(routeParams, ["path"]) ?? undefined,
              description: stringParam(routeParams, ["description"]) ?? undefined,
            })
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.delete": {
            const id = stringParam(routeParams, ["id", "project_id", "projectId"])
            if (!id) {
              sendToolResult("invoke_backend_route", callId, { error: "id is required for projects.delete" })
              return
            }
            const killSession = stringParam(routeParams, ["kill_session", "killSession"]) === "true"
            await deleteProject(id, killSession)
            sendToolResult("invoke_backend_route", callId, { output: { deleted: id } })
            break
          }

          case "projects.launch": {
            const id = stringParam(routeParams, ["id", "project_id", "projectId"])
            if (!id) {
              sendToolResult("invoke_backend_route", callId, { error: "id is required for projects.launch" })
              return
            }
            const data = await launchProject(id)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.sync_from_tmux": {
            const id = stringParam(routeParams, ["id", "project_id", "projectId"])
            if (!id) {
              sendToolResult("invoke_backend_route", callId, { error: "id is required for projects.sync_from_tmux" })
              return
            }
            const data = await syncProjectFromTmux(id)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "projects.generate_ai_html": {
            const id = stringParam(routeParams, ["id", "project_id", "projectId"])
            if (!id) {
              sendToolResult("invoke_backend_route", callId, { error: "id is required for projects.generate_ai_html" })
              return
            }
            const data = await generateProjectAiHtml(id)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "tmux_analysis.list": {
            const options: Record<string, unknown> = {}
            const limit = stringParam(routeParams, ["limit"])
            const projectId = stringParam(routeParams, ["project_id", "projectId"])
            const status = stringParam(routeParams, ["status"])
            if (limit) options.limit = Number(limit)
            if (projectId) options.projectId = projectId
            if (status) options.status = status
            const data = await listAiStats(options)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "tmux_analysis.cleanup": {
            const options: Record<string, unknown> = {}
            const projectId = stringParam(routeParams, ["project_id", "projectId"])
            if (projectId) options.projectId = projectId
            const data = await cleanupAiStats(options)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "ai_logs.list": {
            const options: Record<string, unknown> = {}
            const limit = stringParam(routeParams, ["limit"])
            const before = stringParam(routeParams, ["before"])
            if (limit) options.limit = Number(limit)
            if (before) options.before = before
            const data = await listAiLogs(options)
            sendToolResult("invoke_backend_route", callId, { output: data })
            break
          }

          case "ai_logs.clear": {
            await clearAiLogs()
            sendToolResult("invoke_backend_route", callId, { output: { cleared: true } })
            break
          }

          default: {
            const message = routeId
              ? `Voice backend route is not implemented in the frontend executor: ${routeId}`
              : "Backend route ID is required"
            setError({ code: "voice_tool_failed", message })
            sendToolResult("invoke_backend_route", callId, { error: message })
          }
        }
      }

      void invokeRoute().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : `Failed to execute backend route ${routeId}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult("invoke_backend_route", callId, { error: message })
      })
    },
    [executeSessionMutationIntent, resolveIntentTargetName, resolveIntentSessionName, sendToolResult, setError],
  )

  const resolveIntentWindowQuery = useCallback(
    (params: VoiceIntentParams): string | null =>
      stringParam(params, [
        "window",
        "window_name",
        "windowName",
        "window_id",
        "windowId",
        "window_index",
        "windowIndex",
        "index",
        "position",
        "ordinal",
      ]),
    [],
  )

  const resolveIntentWindowOrdinal = useCallback(
    (params: VoiceIntentParams): number | null => {
      const ordinalParam = stringParam(params, [
        "window_index",
        "windowIndex",
        "index",
        "position",
        "ordinal",
      ])
      if (ordinalParam) {
        return parseOrdinal(ordinalParam)
      }
      const windowText = stringParam(params, ["window", "window_name", "windowName"])
      return windowText && /^第/.test(windowText.trim()) ? parseOrdinal(windowText) : null
    },
    [],
  )

  const resolveIntentWindowTarget = useCallback(
    async (
      targetName: string,
      sessionName: string,
      params: VoiceIntentParams,
    ): Promise<{ window: WindowInfo; windows: WindowInfo[] }> => {
      const response = await listWindows(targetName, sessionName)
      const windows = response.data ?? []
      const query = resolveIntentWindowQuery(params)
      const ordinal = resolveIntentWindowOrdinal(params)
      const selectedWindow = findWindowByVoiceTarget(windows, query, ordinal, false)
      if (!selectedWindow) {
        throw new Error("Window not found")
      }
      return { window: selectedWindow, windows }
    },
    [resolveIntentWindowOrdinal, resolveIntentWindowQuery],
  )

  const resolveIntentPaneId = useCallback(
    (params: VoiceIntentParams): string | null =>
      stringParam(params, ["pane", "pane_index", "paneIndex", "pane_id", "paneId"]),
    [],
  )

  const executeWindowMutationIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      const targetName = resolveIntentTargetName(params)
      const sessionName = resolveIntentSessionName(params)
      if (!targetName || !sessionName) {
        const message = "Target and session are required for window operation"
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
        return
      }

      try {
        let operation: unknown
        let selectedWindow: WindowInfo | null = null
        let updatedWindows: WindowInfo[] = []
        if (skill === "create_window") {
          const newWindowName = stringParam(params, ["window_name", "windowName", "name"])
          operation = await createWindow(targetName, sessionName, newWindowName ?? undefined)
        } else if (skill === "rename_window") {
          selectedWindow = (await resolveIntentWindowTarget(targetName, sessionName, params)).window
          const newName = stringParam(params, ["new_name", "newName", "name"])
          if (!newName) {
            throw new Error("New window name is required")
          }
          operation = await renameWindow(targetName, sessionName, selectedWindow.ID, newName)
        } else if (skill === "delete_window") {
          selectedWindow = (await resolveIntentWindowTarget(targetName, sessionName, params)).window
          operation = await killWindow(targetName, sessionName, selectedWindow.ID)
        } else {
          return
        }

        const windows = await listWindows(targetName, sessionName)
        updatedWindows = windows.data ?? []
        setWindows(targetName, sessionName, updatedWindows)
        sendToolResult(resultSkill, callId, {
          output: {
            targetName,
            session: sessionName,
            window: selectedWindow
              ? { id: selectedWindow.ID, name: selectedWindow.Name, index: selectedWindow.Index }
              : undefined,
            operation: compactOperationForTool(operation),
            count: updatedWindows.length,
            windows: updatedWindows.map((w) => ({ id: w.ID, name: w.Name, index: w.Index })),
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [
      resolveIntentTargetName,
      resolveIntentSessionName,
      resolveIntentWindowTarget,
      sendToolResult,
      setError,
      setWindows,
    ],
  )

  const executePaneMutationIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      const targetName = resolveIntentTargetName(params)
      const sessionName = resolveIntentSessionName(params)
      const paneName = resolveIntentPaneId(params)
      if (!targetName || !sessionName || !paneName) {
        const message = "Target, session, window, and pane are required for pane operation"
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
        return
      }

      try {
        const { window: resolvedWindow } = await resolveIntentWindowTarget(
          targetName,
          sessionName,
          params,
        )
        const windowName = resolvedWindow.ID
        let output: Record<string, unknown> = {}
        if (skill === "split_pane") {
          const horizontal = params.horizontal === true || params.direction === "horizontal"
          const result = await splitPane(targetName, sessionName, windowName, paneName, horizontal)
          output = { targetName, session: sessionName, window: windowName, pane: paneName, operation: compactOperationForTool(result) }
        } else if (skill === "kill_pane") {
          await killPane(targetName, sessionName, windowName, paneName)
          output = { targetName, session: sessionName, window: windowName, pane: paneName, status: "killed" }
        } else if (skill === "read_pane_output") {
          const lines = typeof params.lines === "number" ? params.lines : 50
          const maxBytes = Math.min(lines * 200, 100000)
          const result = await capturePane(targetName, sessionName, windowName, paneName, maxBytes)
          output = { targetName, session: sessionName, window: windowName, pane: paneName, output: result.output }
        } else if (skill === "clear_pane") {
          await clearPane(targetName, sessionName, windowName, paneName)
          output = { targetName, session: sessionName, window: windowName, pane: paneName, status: "cleared" }
        } else if (skill === "send_to_pane") {
          const text = stringParam(params, ["text"]) ?? ""
          const execute = params.execute === true
          const appendEnter = params.append_enter === true
          const control = params.control === true
          const controlSequence = stringParam(params, ["control_sequence"])
          const keys: string[] = []
          if (control && controlSequence) {
            keys.push(controlSequence)
          } else if (text) {
            keys.push(text)
            if (appendEnter) {
              keys.push("Enter")
            }
          }
          if (keys.length > 0) {
            await sendKeysToPane(targetName, sessionName, windowName, paneName, keys)
          }
          output = { targetName, session: sessionName, window: windowName, pane: paneName, text, executed: execute || appendEnter }
        } else {
          return
        }

        sendToolResult(resultSkill, callId, { output })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [
      resolveIntentTargetName,
      resolveIntentSessionName,
      resolveIntentWindowTarget,
      resolveIntentPaneId,
      sendToolResult,
      setError,
    ],
  )

  const executeAgentPromptIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      const agent = skill === "run_claude_prompt" ? "claude" : "codex"
      const prompt = normalizeAgentPrompt(stringParam(params, ["prompt", "text", "message"]) ?? "")
      if (!prompt) {
        const message = "Prompt is required"
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
        return
      }

      const targetName = resolveIntentTargetName(params) ?? selectedPane?.targetName ?? selectedTargetName
      const sessionName = resolveIntentSessionName(params) ?? selectedPane?.session
      if (!targetName || !sessionName) {
        const message = "Target and session are required for agent prompt execution"
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
        return
      }

      try {
        const explicitWindow = Boolean(resolveIntentWindowQuery(params))
        const selectedMatches =
          selectedPane?.targetName === targetName && selectedPane.session === sessionName
        let windowName = selectedMatches && selectedPane?.window && !explicitWindow
          ? selectedPane.window
          : null
        if (!windowName) {
          windowName = (await resolveIntentWindowTarget(targetName, sessionName, params)).window.ID
        }

        const paneQuery = resolveIntentPaneId(params)
        let paneName = paneQuery ?? (
          selectedMatches && selectedPane?.window === windowName ? selectedPane.pane : undefined
        )
        if (!paneName) {
          const panesResponse = await listPanes(targetName, sessionName, windowName)
          paneName = findPane(panesResponse.data ?? [], null)?.ID
        }
        if (!paneName) {
          throw new Error("Pane not found")
        }

        const promptArg = shellDoubleQuote(prompt)
        const command = agent === "claude"
          ? `claude -p ${promptArg}`
          : `codex exec ${promptArg}`
        await sendKeysToPane(targetName, sessionName, windowName, paneName, [command, "Enter"])
        sendToolResult(resultSkill, callId, {
          output: {
            targetName,
            session: sessionName,
            window: windowName,
            pane: paneName,
            agent,
            command,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [
      resolveIntentTargetName,
      resolveIntentSessionName,
      resolveIntentWindowQuery,
      resolveIntentWindowTarget,
      resolveIntentPaneId,
      selectedPane,
      selectedTargetName,
      sendToolResult,
      setError,
    ],
  )

  const executeProjectMutationIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      try {
        let output: Record<string, unknown> = {}
        if (skill === "list_projects") {
          const projects = await listProjects()
          output = { count: projects.length, projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path })) }
        } else if (skill === "create_project") {
          const name = stringParam(params, ["name"]) ?? ""
          const projectPath = stringParam(params, ["path"]) ?? ""
          const description = stringParam(params, ["description"]) ?? undefined
          const sessionName = stringParam(params, ["session_name", "sessionName"]) ?? undefined
          const workdir = stringParam(params, ["workdir"]) ?? undefined
          const result = await createProject({ name, path: projectPath, description, sessionName, workdir })
          output = { project: result }
        } else if (skill === "update_project") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          if (!projectId) {
            throw new Error("Project ID is required")
          }
          const result = await updateProject(projectId, {
            name: stringParam(params, ["name"]) ?? undefined,
            path: stringParam(params, ["path"]) ?? undefined,
            description: stringParam(params, ["description"]) ?? undefined,
            sessionName: stringParam(params, ["session_name", "sessionName"]) ?? undefined,
            workdir: stringParam(params, ["workdir"]) ?? undefined,
          })
          output = { project: result }
        } else if (skill === "delete_project") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          const killSessionFlag = params.kill_session === true
          if (!projectId) {
            throw new Error("Project ID is required")
          }
          await deleteProject(projectId, killSessionFlag)
          output = { projectId, deleted: true }
        } else if (skill === "launch_project") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          if (!projectId) {
            throw new Error("Project ID is required")
          }
          const result = await launchProject(projectId)
          output = { projectId, result }
        } else if (skill === "sync_project_from_tmux") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          if (!projectId) {
            throw new Error("Project ID is required")
          }
          const result = await syncProjectFromTmux(projectId)
          output = { projectId, result }
        } else if (skill === "generate_project_ai_html") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          if (!projectId) {
            throw new Error("Project ID is required")
          }
          const result = await generateProjectAiHtml(projectId)
          output = { projectId, result }
        } else {
          return
        }

        sendToolResult(resultSkill, callId, { output })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [sendToolResult, setError],
  )

  const executeConfigIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      try {
        let output: Record<string, unknown> = {}
        if (skill === "get_config") {
          const config = await getConfig()
          output = { config }
        } else if (skill === "check_health") {
          const targetName = stringParam(params, ["target_name", "targetName"])
          if (targetName) {
            const health = await getConnectionHealth(targetName)
            output = { targetName, health }
          } else {
            const health = await fetchHealth()
            output = { health }
          }
        } else if (skill === "toggle_omni") {
          const enabled = params.enabled === true
          const config = await getConfig()
          await updateConfig({ ...config, omni: { ...config.omni, enabled } } as AppConfig)
          output = { enabled }
        } else if (skill === "set_voice") {
          const voice = stringParam(params, ["voice"])
          if (!voice) {
            throw new Error("Voice is required")
          }
          const config = await getConfig()
          await updateConfig({ ...config, omni: { ...config.omni, voice } } as AppConfig)
          output = { voice }
        } else if (skill === "toggle_continuous_listening") {
          const enabled = params.enabled === true
          const config = await getConfig()
          await updateConfig({ ...config, omni: { ...config.omni, continuousListening: enabled } } as AppConfig)
          output = { enabled }
        } else if (skill === "toggle_vad") {
          const enabled = params.enabled !== false
          const threshold = typeof params.threshold === "number" ? params.threshold : undefined
          const config = await getConfig()
          await updateConfig({ ...config, omni: { ...config.omni, vadEnabled: enabled, ...(threshold !== undefined ? { vadThreshold: threshold } : {}) } } as AppConfig)
          output = { enabled, threshold }
        } else if (skill === "set_theme") {
          const theme = stringParam(params, ["theme"])
          if (!theme || (theme !== "light" && theme !== "dark")) {
            throw new Error("Theme must be 'light' or 'dark'")
          }
          const config = await getConfig()
          await updateConfig({ ...config, ui: { ...config.ui, theme } } as AppConfig)
          output = { theme }
        } else if (skill === "set_font_size") {
          const size = typeof params.size === "number" ? params.size : undefined
          if (!size) {
            throw new Error("Font size is required")
          }
          const config = await getConfig()
          await updateConfig({ ...config, ui: { ...config.ui, fontSize: size } } as AppConfig)
          output = { size }
        } else if (skill === "set_terminal_font") {
          const fontSize = typeof params.fontSize === "number" ? params.fontSize : undefined
          const fontWeight = stringParam(params, ["fontWeight"])
          if (!fontSize) {
            throw new Error("Terminal font size is required")
          }
          const config = await getConfig()
          await updateConfig({ ...config, ui: { ...config.ui, terminalFontSize: fontSize, ...(fontWeight ? { terminalFontWeight: fontWeight } : {}) } } as AppConfig)
          output = { fontSize, fontWeight }
        } else {
          return
        }

        sendToolResult(resultSkill, callId, { output })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [sendToolResult, setError],
  )

  const executeAnalysisIntent = useCallback(
    async (
      skill: string,
      params: VoiceIntentParams,
      callId?: string,
      resultSkill: string = skill,
    ) => {
      try {
        let output: Record<string, unknown> = {}
        if (skill === "analyze_session") {
          const targetName = resolveIntentTargetName(params)
          const sessionName = resolveIntentSessionName(params)
          if (!targetName || !sessionName) {
            throw new Error("Target and session are required")
          }
          const result = await analyzeSession(targetName, sessionName)
          output = { targetName, session: sessionName, result }
        } else if (skill === "list_tmux_analysis") {
          const limit = typeof params.limit === "number" ? params.limit : 50
          const projectId = stringParam(params, ["project_id", "projectId"])
          const status = stringParam(params, ["status"])
          const result = await listAiStats({ limit, projectId: projectId ?? undefined, status: status ?? undefined })
          output = { result }
        } else if (skill === "cleanup_tmux_analysis") {
          const projectId = stringParam(params, ["project_id", "projectId"])
          const result = await cleanupAiStats({ projectId: projectId ?? undefined })
          output = { result }
        } else if (skill === "list_ai_logs") {
          const limit = typeof params.limit === "number" ? params.limit : 50
          const before = stringParam(params, ["before"])
          const result = await listAiLogs({ limit, before: before ?? undefined })
          output = { result }
        } else if (skill === "clear_ai_logs") {
          await clearAiLogs()
          output = { cleared: true }
        } else {
          return
        }

        sendToolResult(resultSkill, callId, { output })
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to execute ${skill}`
        setError({ code: "voice_tool_failed", message })
        sendToolResult(resultSkill, callId, { error: message })
      }
    },
    [resolveIntentTargetName, resolveIntentSessionName, sendToolResult, setError],
  )

  const executeRunProjectIntent = useCallback(
    async (params: VoiceIntentParams, callId?: string) => {
      const targetName = resolveIntentTargetName(params)
      const sessionName = resolveIntentSessionName(params)
      const paneName = resolveIntentPaneId(params)
      const projectPath = stringParam(params, ["project_path", "projectPath"])
      const startCommand = stringParam(params, ["start_command", "startCommand"])

      if (!targetName || !sessionName || !paneName || !projectPath || !startCommand) {
        const message = "Target, session, pane, project path, and start command are required to run a project"
        setError({ code: "voice_tool_failed", message })
        sendToolResult("run_project", callId, { error: message })
        return
      }

      try {
        const { window: resolvedWindow } = await resolveIntentWindowTarget(
          targetName,
          sessionName,
          params,
        )
        const windowName = resolvedWindow.ID
        const cdCommand = `cd "${projectPath}"`
        await sendKeysToPane(targetName, sessionName, windowName, paneName, [cdCommand, "Enter"])
        await new Promise((resolve) => setTimeout(resolve, 500))
        await sendKeysToPane(targetName, sessionName, windowName, paneName, [startCommand, "Enter"])
        sendToolResult("run_project", callId, {
          output: {
            targetName,
            session: sessionName,
            window: windowName,
            pane: paneName,
            projectPath,
            commands: [cdCommand, startCommand],
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to run project"
        setError({ code: "voice_tool_failed", message })
        sendToolResult("run_project", callId, { error: message })
      }
    },
    [
      resolveIntentTargetName,
      resolveIntentSessionName,
      resolveIntentPaneId,
      resolveIntentWindowTarget,
      sendToolResult,
      setError,
    ],
  )

  const handleFrontendIntent = useCallback(
    (skill: string, params: VoiceIntentParams, callId?: string, confirmationRequired = false) => {
      if (skill === "new_chat") {
        void handleNewChat()
        return
      }

      if (skill === "list_sessions") {
        emitSidebarNavigation("session")
        void executeListSessionsIntent(params, callId)
        return
      }

      if (
        !confirmationRequired &&
        (skill === "create_session" || skill === "rename_session" || skill === "delete_session")
      ) {
        emitSidebarNavigation("session")
        void executeSessionMutationIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && skill === "invoke_backend_route") {
        emitSidebarNavigation("session")
        executeBackendRouteIntent(params, callId)
        return
      }

      if (skill === "get_current_focus") {
        if (wsRef.current?.isConnected()) {
          const context = sendSessionContext(wsRef.current)
          sendToolResult(skill, callId, { output: context })
        }
        return
      }

      if (skill === "focus_pane") {
        emitSidebarNavigation("session")
        reportIntentPromise(skill, callId, openWorkspaceTarget(params))
        return
      }

      if (skill === "switch_window") {
        emitSidebarNavigation("session")
        reportIntentPromise(skill, callId, openWorkspaceTarget(params))
        return
      }

      if (!confirmationRequired && (skill === "create_window" || skill === "rename_window" || skill === "delete_window")) {
        emitSidebarNavigation("session")
        void executeWindowMutationIntent(skill, params, callId)
        return
      }

      if (
        !confirmationRequired &&
        (skill === "split_pane" || skill === "read_pane_output" || skill === "send_to_pane" ||
         skill === "kill_pane" || skill === "clear_pane")
      ) {
        emitSidebarNavigation("session")
        void executePaneMutationIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && (skill === "run_claude_prompt" || skill === "run_codex_prompt")) {
        emitSidebarNavigation("session")
        void executeAgentPromptIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && skill === "list_projects") {
        emitSidebarNavigation("projects")
        void executeProjectMutationIntent(skill, params, callId)
        return
      }

      if (
        !confirmationRequired &&
        (skill === "create_project" || skill === "update_project" || skill === "launch_project" ||
         skill === "sync_project_from_tmux" || skill === "generate_project_ai_html" ||
         skill === "delete_project")
      ) {
        emitSidebarNavigation("projects")
        void executeProjectMutationIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && skill === "run_project") {
        emitSidebarNavigation("session")
        void executeRunProjectIntent(params, callId)
        return
      }

      if (!confirmationRequired && (skill === "get_config" || skill === "check_health")) {
        void executeConfigIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && (skill === "toggle_omni" || skill === "set_voice" || skill === "toggle_continuous_listening" || skill === "toggle_vad" || skill === "set_theme" || skill === "set_font_size" || skill === "set_terminal_font")) {
        void executeConfigIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && (skill === "analyze_session" || skill === "list_tmux_analysis")) {
        void executeAnalysisIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && (skill === "cleanup_tmux_analysis" || skill === "clear_ai_logs")) {
        void executeAnalysisIntent(skill, params, callId)
        return
      }

      if (!confirmationRequired && skill === "list_ai_logs") {
        void executeAnalysisIntent(skill, params, callId)
        return
      }

      if (skill !== "navigate_frontend") return

      const route = stringParam(params, ["route"]) ?? ""
      if (route === "settings") {
        setShowSettingsPanel(true)
        window.history.pushState(null, "", `${window.location.pathname}?view=settings`)
        sendToolResult(skill, callId, { output: { route } })
        return
      }

      if (route === "connections") {
        setShowNewConnectionForm(true)
        sendToolResult(skill, callId, { output: { route } })
        return
      }

      if (route === "home") {
        setShowSettingsPanel(false)
        setShowErrorLogsPanel(false)
        setSelectedProject(null)
        setSelectedPane(null)
        window.history.replaceState(null, "", window.location.pathname)
        sendToolResult(skill, callId, { output: { route } })
        return
      }

      if (route === "projects" || route === "project") {
        emitSidebarNavigation("projects")
        reportIntentPromise(skill, callId, openProjectTarget(params))
        return
      }

      if (route === "session" || route === "window" || route === "pane") {
        emitSidebarNavigation("session")
        if (resolveIntentSessionName(params)) {
          reportIntentPromise(skill, callId, openWorkspaceTarget(params))
        } else {
          sendToolResult(skill, callId, { output: { route } })
        }
        return
      }

      emitSidebarNavigation(route)
      sendToolResult(skill, callId, { output: { route } })
    },
    [
      handleNewChat,
      executeListSessionsIntent,
      executeBackendRouteIntent,
      executeSessionMutationIntent,
      executeWindowMutationIntent,
      executePaneMutationIntent,
      executeAgentPromptIntent,
      executeProjectMutationIntent,
      executeConfigIntent,
      executeAnalysisIntent,
      executeRunProjectIntent,
      resolveIntentTargetName,
      resolveIntentSessionName,
      resolveIntentWindowQuery,
      resolveIntentPaneId,
      openProjectTarget,
      openWorkspaceTarget,
      reportIntentPromise,
      sendSessionContext,
      sendToolResult,
      setSelectedPane,
      setSelectedProject,
      setShowErrorLogsPanel,
      setShowNewConnectionForm,
      setShowSettingsPanel,
    ],
  )

  const sendPendingConfirmationResponse = useCallback(
    (response: "confirm" | "cancel"): boolean => {
      const pendingConfirmation = omniPendingConfirmationRef.current
      if (!pendingConfirmation) {
        return false
      }

      if (wsRef.current?.isConnected()) {
        wsRef.current.send({
          type: response === "confirm" ? "confirm_action" : "cancel_action",
          confirmationId: pendingConfirmation.confirmationId,
        })
      }

      if (response === "cancel") {
        omniPendingConfirmationRef.current = null
        setOmniConfirmation(null)
        setOmniStatus("listening")
      } else {
        omniPendingConfirmationRef.current = null
        setOmniConfirmation(null)
        setOmniStatus("processing")
        if (pendingConfirmation.params) {
          handleFrontendIntent(
            pendingConfirmation.skill,
            pendingConfirmation.params,
            pendingConfirmation.callId,
            false,
          )
        }
      }

      return true
    },
    [handleFrontendIntent, setOmniConfirmation, setOmniStatus],
  )

  const applyTranscriptCorrection = useCallback(
    (text: string) => {
      const correctedText = text.trim()
      if (!correctedText) return

      pendingTranscriptCorrectionRef.current = correctedText
      if (omniTranscriptRef.current) {
        setOmniTranscript(correctedText)
      }

      const shouldTryReplaceHistory = Date.now() - lastFinalTranscriptAtRef.current < 10000
      if (!shouldTryReplaceHistory) return

      pendingTranscriptCorrectionRef.current = null
      setHistory((prev) => {
        const latestIndex = prev.length - 1
        const next = [...prev]
        const message = next[latestIndex]
        if (!message || message.role !== "user" || message.kind !== "transcript") {
          return prev
        }
        next[latestIndex] = { ...message, text: correctedText }
        return next
      })
    },
    [setOmniTranscript],
  )

  const handleServerMessage = useCallback(
    (event: OmniServerEvent) => {
      if (isVoiceConnectedEvent(event)) {
        if (omniStatusRef.current === "connecting") {
          setOmniStatus("listening")
        }
        return
      }

      if (isVoiceTranscriptDeltaEvent(event)) {
        appendVoiceTranscript(event.text)
        setOmniError(null)
        return
      }

      if (isVoiceTranscriptCorrectedEvent(event)) {
        applyTranscriptCorrection(event.text)
        return
      }

      if (isVoiceTranscriptDoneEvent(event)) {
        const confirmationResponse = parseVoiceConfirmation(event.text)
        const transcriptText = pendingTranscriptCorrectionRef.current ?? event.text
        pendingTranscriptCorrectionRef.current = null
        setOmniTranscript("")
        clearAssistantDraft()
        lastFinalTranscriptAtRef.current = Date.now()
        setHistory((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-user`,
            conversationId: "default",
            role: "user",
            kind: "transcript",
            text: transcriptText,
            createdAt: new Date().toISOString(),
          },
        ])
        if (confirmationResponse && sendPendingConfirmationResponse(confirmationResponse)) {
          return
        }
        setOmniStatus("processing")
        return
      }

      if (isVoiceIntentReceivedEvent(event)) {
        if (event.confirmationRequired && event.confirmationId) {
          const pendingConfirmation = {
            confirmationId: event.confirmationId,
            skill: event.skill,
            params: event.params,
            callId: event.callId,
          }
          omniPendingConfirmationRef.current = pendingConfirmation
          setOmniConfirmation(pendingConfirmation)
          setOmniStatus("confirming")
        } else {
          handleFrontendIntent(event.skill, event.params, event.callId, event.confirmationRequired)
          setOmniStatus("processing")
        }
        return
      }

      if (isVoiceActionResultEvent(event)) {
        omniPendingConfirmationRef.current = null
        setOmniConfirmation(null)
        if (event.success) {
          lastSuccessfulConfirmationAtRef.current = Date.now()
          setOmniStatus("listening")
          setHistory((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}-assistant`,
              conversationId: "default",
              role: "assistant",
              kind: "action_result",
              text: `Executed: ${event.skill}`,
              createdAt: new Date().toISOString(),
            },
          ])
        } else {
          setOmniError(event.error ?? `Action failed: ${event.skill}`)
          setOmniStatus("error")
        }
        return
      }

      if (isVoiceAssistantDeltaEvent(event)) {
        if (suppressAssistantOutputRef.current) return
        if (event.text) {
          appendAssistantDraft(event.text)
        }
        setOmniStatus("speaking")
        setOmniError(null)
        return
      }

      if (isVoiceAssistantMessageEvent(event)) {
        if (suppressAssistantOutputRef.current) return
        const text = event.text || assistantDraftRef.current
        clearAssistantDraft()
        setOmniStatus("idle")
        if (text) {
          setHistory((prev) => [
            ...prev,
            {
              id: `local-${Date.now()}-assistant-message`,
              conversationId: "default",
              role: "assistant",
              kind: "assistant_text",
              text,
              createdAt: new Date().toISOString(),
            },
          ])
        }
        return
      }

      if (isVoiceAudioDeltaEvent(event)) {
        if (suppressAssistantOutputRef.current) return
        setOmniStatus("speaking")
        if (!audioMutedRef.current) {
          pipelineRef.current?.enqueuePlayback(event.pcm16Base64, event.sampleRate)
        }
        return
      }

      if (isVoiceTokenUsageEvent(event)) {
        if (suppressAssistantOutputRef.current) return
        setTokenUsage((prev) => ({
          last: event.usage,
          total: addTokenUsage(prev.total, event.usage),
        }))
        return
      }

      if (isVoiceErrorEvent(event)) {
        const isRecentSuccessfulConfirmation = Date.now() - lastSuccessfulConfirmationAtRef.current < 3000
        const isUnspecifiedError =
          (event.code === "dashscope_error" || event.code === "unknown") &&
          (event.message === "DashScope realtime error" || event.message === "Unknown error")
        if (isRecentSuccessfulConfirmation && isUnspecifiedError) {
          return
        }
        setOmniError(event.message)
        setOmniStatus("error")
      }
    },
    [
      appendVoiceTranscript,
      appendAssistantDraft,
      clearAssistantDraft,
      setOmniTranscript,
      setOmniConfirmation,
      setOmniError,
      setOmniStatus,
      handleFrontendIntent,
      sendPendingConfirmationResponse,
      applyTranscriptCorrection,
    ],
  )

  const connectVoice = useCallback(() => {
    if (wsConnectingRef.current || wsRef.current) return

    wsConnectingRef.current = true
    setWsConnecting(true)
    omniStatusRef.current = "connecting"
    setOmniStatus("connecting")
    setOmniTranscript("")
    pendingTranscriptCorrectionRef.current = null
    lastFinalTranscriptAtRef.current = 0
    clearAssistantDraft()
    setOmniError(null)
    suppressAssistantOutputRef.current = false

    // Use OmniIpc (IPC Channel-based) instead of OmniWebSocket
    // This keeps the DashScope API key in the backend
    const ws = new OmniIpc({
      onMessage: (event: OmniServerEvent) => {
        handleServerMessage(event)
      },
      onOpen: () => {
        wsConnectingRef.current = false
        setWsConnecting(false)
        if (omniStatusRef.current === "connecting") {
          setOmniStatus("listening")
        }
        setOmniError(null)
      },
      onClose: () => {
        wsConnectingRef.current = false
        setWsConnecting(false)
        setMicCapturing(false)
        if (omniStatusRef.current !== "disabled" && omniStatusRef.current !== "error") {
          setOmniStatus("idle")
        }
        wsRef.current = null
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "Voice connection failed"
        wsConnectingRef.current = false
        setWsConnecting(false)
        setMicCapturing(false)
        pipelineRef.current?.stopCapture()
        omniStatusRef.current = "error"
        setOmniError(message)
        setOmniStatus("error")
        void ws.close()
      },
    })

    sendSessionContext(ws)
    ws.connect().catch(() => {})
    wsRef.current = ws
  }, [
    clearAssistantDraft,
    handleServerMessage,
    sendSessionContext,
    setOmniStatus,
    setOmniTranscript,
    setOmniError,
  ])

  const startListening = useCallback(async () => {
    if (micDisabled) return
    if (!micAvailable) {
      const granted = getRuntimeFlags().isElectron ? await requestMicrophoneAccess() : null
      setOmniError(
        getRuntimeFlags().isElectron
          ? "Microphone is unavailable. Open macOS System Settings and allow Emux to use the microphone."
          : "Microphone is unavailable in this browser",
      )
      setOmniStatus("error")
      if (getRuntimeFlags().isElectron && granted !== true) {
        void openMicrophonePermissions()
      }
      return
    }

    if (getRuntimeFlags().isElectron) {
      const granted = await requestMicrophoneAccess()
      if (granted === false) {
        setOmniError(
          "Microphone access denied. Open macOS System Settings and allow Emux to use the microphone.",
        )
        setOmniStatus("error")
        void openMicrophonePermissions()
        return
      }
    }

    if (!pipelineRef.current) {
      pipelineRef.current = createAudioPipeline()
      pipelineRef.current.setVolume(volume)
    }

    try {
      suppressAssistantOutputRef.current = false
      await pipelineRef.current.startCapture(
        (frameBase64, sampleRate) => {
          if (wsRef.current?.isConnected()) {
            wsRef.current.send({ type: "audio_frame", pcm16Base64: frameBase64, sampleRate })
          }
        },
        {
          onLevel: (level) => {
            audioLevel.current = level
            const activeBars = Math.min(LEVEL_SEGMENTS, Math.floor(level / 10))
            setAudioBars((prev) => {
              const next = [...prev]
              for (let i = 0; i < LEVEL_SEGMENTS; i++) {
                next[i] = i < activeBars
              }
              return next
            })
          },
        },
      )
      setMicCapturing(true)
      setOmniTranscript("")
      clearAssistantDraft()
      setOmniError(null)
      connectVoice()
    } catch {
      setMicCapturing(false)
      const granted = getRuntimeFlags().isElectron ? await requestMicrophoneAccess() : null
      setOmniError(
        getRuntimeFlags().isElectron
          ? "Microphone access denied. Open macOS System Settings and allow Emux to use the microphone."
          : "Microphone access denied",
      )
      setOmniStatus("error")
      if (getRuntimeFlags().isElectron && granted !== true) {
        void openMicrophonePermissions()
      }
    }
  }, [
    clearAssistantDraft,
    connectVoice,
    setOmniTranscript,
    setOmniError,
    setOmniStatus,
    micDisabled,
    micAvailable,
  ])

  const stopListening = useCallback(() => {
    pipelineRef.current?.stopCapture()
    if (wsRef.current?.isConnected()) {
      wsRef.current.send({ type: "stop_listening" })
    }
    setMicCapturing(false)
    setAudioBars(new Array(LEVEL_SEGMENTS).fill(false))
    if (omniStatusRef.current === "listening" || omniStatusRef.current === "connecting") {
      setOmniStatus("idle")
    }
  }, [setOmniStatus])

  const handleMuteToggle = useCallback(() => {
    setAudioMuted((current) => {
      const next = !current
      audioMutedRef.current = next
      if (next) {
        pipelineRef.current?.stopPlayback()
      } else {
        setVolume((v) => {
          if (v === 0) {
            localStorage.setItem("omni-volume", "0.5")
            pipelineRef.current?.setVolume(0.5)
            return 0.5
          }
          pipelineRef.current?.setVolume(v)
          return v
        })
      }
      return next
    })
  }, [])

  const handleVolumeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(event.target.value)
    setVolume(val)
    localStorage.setItem("omni-volume", String(val))
    if (pipelineRef.current) {
      pipelineRef.current.setVolume(val)
    }
    if (val > 0 && audioMutedRef.current) {
      setAudioMuted(false)
      audioMutedRef.current = false
    } else if (val === 0 && !audioMutedRef.current) {
      setAudioMuted(true)
      audioMutedRef.current = true
      pipelineRef.current?.stopPlayback()
    }
  }, [])

  const handleStopResponse = useCallback(() => {
    suppressAssistantOutputRef.current = true
    pipelineRef.current?.stopPlayback()
    clearAssistantDraft()
    setOmniTranscript("")
    setOmniConfirmation(null)
    setOmniError(null)
    const responseActive =
      omniStatusRef.current === "processing" ||
      omniStatusRef.current === "speaking" ||
      omniStatusRef.current === "confirming" ||
      Boolean(assistantDraftRef.current)
    if (responseActive && wsRef.current?.isConnected()) {
      wsRef.current.send({ type: "stop_response" })
    }
    if (omniStatusRef.current !== "disabled") {
      setOmniStatus("idle")
    }
  }, [
    clearAssistantDraft,
    setOmniConfirmation,
    setOmniError,
    setOmniStatus,
    setOmniTranscript,
  ])

  const handleConfirm = useCallback(() => {
    sendPendingConfirmationResponse("confirm")
  }, [sendPendingConfirmationResponse])

  const handleCancel = useCallback(() => {
    sendPendingConfirmationResponse("cancel")
  }, [sendPendingConfirmationResponse])

  const handleReconnect = useCallback(() => {
    stopListening()
    setOmniStatus("idle")
    void startListening()
  }, [startListening, stopListening, setOmniStatus])

  const handleTextSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const text = inputText.trim()
      if (!text) return

      const existingWs = wsRef.current
      connectVoice()
      if (!wsRef.current) {
        setOmniError("Connection failed")
        setOmniStatus("error")
        return
      }
      if (!pipelineRef.current) {
        pipelineRef.current = createAudioPipeline()
        pipelineRef.current.setVolume(volume)
      }

      const now = new Date().toISOString()
      setHistory((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-typed-user`,
          conversationId: "default",
          role: "user",
          kind: "typed_text",
          text,
          createdAt: now,
        },
      ])
      setInputText("")
      setOmniTranscript("")
      clearAssistantDraft()
      setOmniError(null)
      suppressAssistantOutputRef.current = false
      const confirmationResponse = parseVoiceConfirmation(text)
      if (confirmationResponse && sendPendingConfirmationResponse(confirmationResponse)) {
        return
      }
      omniStatusRef.current = "processing"
      setOmniStatus("processing")
      if (existingWs) {
        sendSessionContext(wsRef.current)
      }
      wsRef.current.send({ type: "text_message", text })
    },
    [
      clearAssistantDraft,
      connectVoice,
      inputText,
      sendSessionContext,
      sendPendingConfirmationResponse,
      setOmniError,
      setOmniStatus,
      setOmniTranscript,
    ],
  )

  useEffect(() => {
    return () => {
      pipelineRef.current?.stopCapture()
      pipelineRef.current?.stopPlayback()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  const beginResize = useCallback(
    (direction: "width" | "height" | "both") => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      startAssistantResize(event.clientX, event.clientY, event.pointerId, direction)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [startAssistantResize],
  )

  const beginMouseResize = useCallback(
    (direction: "width" | "height" | "both") => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (resizeStartRef.current || event.button !== 0) return
      event.preventDefault()
      startAssistantResize(event.clientX, event.clientY, "mouse", direction)
    },
    [startAssistantResize],
  )

  const updateResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      updateAssistantResize(event.clientX, event.clientY, event.pointerId)
    },
    [updateAssistantResize],
  )

  const endResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      finishAssistantResize(event.pointerId)
    },
    [finishAssistantResize],
  )

  const startDrag = useCallback(
    (clientX: number, clientY: number, pointerId: number | "mouse") => {
      dragStartRef.current = {
        pointerId,
        originX: clientX,
        originY: clientY,
        baseX: assistantPos.x,
        baseY: assistantPos.y,
      }
      document.body.style.cursor = "grabbing"
      document.body.style.userSelect = "none"
    },
    [assistantPos],
  )

  const updateDrag = useCallback(
    (clientX: number, clientY: number, pointerId: number | "mouse") => {
      const drag = dragStartRef.current
      if (!drag || drag.pointerId !== pointerId) return
      const dx = clientX - drag.originX
      const dy = clientY - drag.originY
      setAssistantPos(() => {
        const nextPos = clampAssistantPos(
          { x: drag.baseX + dx, y: drag.baseY + dy },
          assistantSizeRef.current,
        )
        assistantPosRef.current = nextPos
        return nextPos
      })
    },
    [],
  )

  const finishDrag = useCallback((pointerId: number | "mouse") => {
    const drag = dragStartRef.current
    if (!drag || drag.pointerId !== pointerId) return
    dragStartRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    saveLauncherPos(launcherPosFromDialog(assistantPosRef.current, assistantSizeRef.current))
  }, [])

  useEffect(() => {
    let lastWidth = window.innerWidth
    let lastHeight = window.innerHeight

    const handleWindowResize = () => {
      const newWidth = window.innerWidth
      const newHeight = window.innerHeight

      setAssistantSize((current) => {
        const nextSize = clampAssistantSize(current)
        assistantSizeRef.current = nextSize
        return nextSize
      })
      setAssistantPos((current) => {
        const nextPos = scalePosOnResize(
          current,
          assistantSizeRef.current,
          lastWidth,
          lastHeight,
          newWidth,
          newHeight,
        )
        assistantPosRef.current = nextPos
        saveLauncherPos(launcherPosFromDialog(nextPos, assistantSizeRef.current))
        return nextPos
      })

      lastWidth = newWidth
      lastHeight = newHeight
    }
    window.addEventListener("resize", handleWindowResize)
    return () => window.removeEventListener("resize", handleWindowResize)
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      updateAssistantResize(event.clientX, event.clientY, event.pointerId)
      updateDrag(event.clientX, event.clientY, event.pointerId)
    }
    const handlePointerUp = (event: PointerEvent) => {
      finishAssistantResize(event.pointerId)
      finishDrag(event.pointerId)
    }
    const handleMouseMove = (event: MouseEvent) => {
      updateAssistantResize(event.clientX, event.clientY, "mouse")
      updateDrag(event.clientX, event.clientY, "mouse")
    }
    const handleMouseUp = () => {
      finishAssistantResize("mouse")
      finishDrag("mouse")
    }
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [finishAssistantResize, updateAssistantResize, updateDrag, finishDrag])

  const isListening =
    omniStatus === "listening" ||
    omniStatus === "processing" ||
    omniStatus === "speaking" ||
    omniStatus === "confirming"
  const isRunning =
    micCapturing ||
    omniStatus === "connecting" ||
    omniStatus === "processing" ||
    omniStatus === "speaking" ||
    omniStatus === "confirming" ||
    omniStatus === "listening"
  const isDisabled = omniStatus === "disabled"
  const visibleHistory = history.slice(-10)
  const latestHistoryId = history[history.length - 1]?.id ?? ""
  const showEmptyState =
    !historyLoading &&
    visibleHistory.length === 0 &&
    !omniTranscript &&
    !assistantDraft &&
    !omniError &&
    !omniPendingConfirmation
  const handleMicToggle = micCapturing
    ? stopListening
    : omniStatus === "error"
      ? handleReconnect
      : startListening
  const totalVisibleInputTokens = displayInputTokens(tokenUsage.total)
  const totalSkillTokens = tokenUsage.total.skillTokens ?? 0
  const totalCacheReadTokens = tokenUsage.total.cacheReadTokens ?? 0
  const lastVisibleInputTokens = tokenUsage.last ? displayInputTokens(tokenUsage.last) : 0
  const lastSkillTokens = tokenUsage.last?.skillTokens ?? 0
  const lastCacheReadTokens = tokenUsage.last?.cacheReadTokens ?? 0

  useLayoutEffect(() => {
    scrollChatToBottom()
    const animationFrame = window.requestAnimationFrame(scrollChatToBottom)
    const timeout = window.setTimeout(scrollChatToBottom, 60)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.clearTimeout(timeout)
    }
  }, [
    historyLoading,
    latestHistoryId,
    omniTranscript,
    assistantDraft,
    omniPendingConfirmation?.confirmationId,
    omniError,
    showEmptyState,
    scrollChatToBottom,
  ])

  return (
    <div
      className="ai-assistant"
      data-ai-assistant-state={omniStatus}
      style={
        {
          "--ai-assistant-width": `${assistantSize.width}px`,
          "--ai-assistant-height": `${assistantSize.height}px`,
          "--ai-assistant-x": `${assistantPos.x}px`,
          "--ai-assistant-y": `${assistantPos.y}px`,
        } as CSSProperties
      }
    >
      {/* Border Drag Handles for Resizing */}
      <div
        className="voice-resize-edge voice-resize-edge--top"
        onPointerDown={beginResize("height")}
        onPointerMove={updateResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onMouseDown={beginMouseResize("height")}
      />
      <div
        className="voice-resize-edge voice-resize-edge--left"
        onPointerDown={beginResize("width")}
        onPointerMove={updateResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onMouseDown={beginMouseResize("width")}
      />
      <div
        className="voice-resize-corner voice-resize-corner--top-left"
        onPointerDown={beginResize("both")}
        onPointerMove={updateResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onMouseDown={beginMouseResize("both")}
      />
      <div
        className="voice-header voice-header--draggable"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const target = e.target as HTMLElement
          if (target.closest("button")) return
          e.preventDefault()
          startDrag(e.clientX, e.clientY, e.pointerId)
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onMouseDown={(e) => {
          if (dragStartRef.current || e.button !== 0) return
          const target = e.target as HTMLElement
          if (target.closest("button")) return
          e.preventDefault()
          startDrag(e.clientX, e.clientY, "mouse")
        }}
      >
        <div className="voice-title">
          <span className="voice-status-dot" />
        </div>
        <div className="voice-status-label">
          <span key={omniStatus}>{omniStatus}</span>
        </div>
        <div className="voice-token-meter-container" ref={tokenMeterContainerRef}>
          <button
            type="button"
            id="ai-token-popover-btn"
            className={`voice-token-meter-btn ${showTokenPopover ? "voice-token-meter-btn--active" : ""} ${pulseActive ? "voice-token-meter-btn--pulse" : ""}`}
            data-testid="ai-token-meter"
            aria-live="polite"
            aria-label="View token usage details"
            onClick={() => setShowTokenPopover(!showTokenPopover)}
          >
            <span className="token-icon" aria-hidden="true">🪙</span>
            <span className="token-count-total">Total {formatTokenCount(tokenUsage.total.totalTokens)}</span>
            {tokenUsage.last && (
              <span className="token-count-last">Last {formatTokenCount(tokenUsage.last.totalTokens)}</span>
            )}
          </button>

          {showTokenPopover && (
            <div className="voice-token-popover" id="ai-token-popover" role="dialog" aria-label="Token Usage Statistics">
              <div className="voice-token-popover-header">
                <span className="popover-title">Token Usage Details</span>
                <button
                  type="button"
                  id="ai-token-reset-btn"
                  className="voice-token-reset-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleNewChat()
                  }}
                  title="Reset conversation and stats"
                >
                  Reset Chat & Stats
                </button>
              </div>

              <div className="voice-token-visual-bar">
                <div className="bar-label">
                  <span>Input, Skills, Output Allocation</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-segment input-segment"
                    style={{
                      width: `${tokenUsage.total.totalTokens > 0 ? percentOfTotal(totalVisibleInputTokens, tokenUsage.total.totalTokens) : 50}%`,
                    }}
                    title={`Input: ${formatTokenCount(totalVisibleInputTokens)} tokens`}
                  />
                  <div
                    className="progress-segment skills-segment"
                    style={{
                      width: `${percentOfTotal(totalSkillTokens, tokenUsage.total.totalTokens)}%`,
                    }}
                    title={`Skills: ${formatTokenCount(totalSkillTokens)} tokens`}
                  />
                  <div
                    className="progress-segment output-segment"
                    style={{
                      width: `${tokenUsage.total.totalTokens > 0 ? percentOfTotal(tokenUsage.total.outputTokens, tokenUsage.total.totalTokens) : 50}%`,
                    }}
                    title={`Output: ${formatTokenCount(tokenUsage.total.outputTokens)} tokens`}
                  />
                </div>
                <div className="progress-legend">
                  <span className="legend-item input-legend">
                    <span className="legend-dot" /> Input ({Math.round(percentOfTotal(totalVisibleInputTokens, tokenUsage.total.totalTokens))}%)
                  </span>
                  <span className="legend-item skills-legend">
                    <span className="legend-dot" /> Skills ({Math.round(percentOfTotal(totalSkillTokens, tokenUsage.total.totalTokens))}%)
                  </span>
                  <span className="legend-item output-legend">
                    <span className="legend-dot" /> Output ({Math.round(percentOfTotal(tokenUsage.total.outputTokens, tokenUsage.total.totalTokens))}%)
                  </span>
                </div>
              </div>

              <table className="voice-token-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Last Msg</th>
                    <th>Total Session</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="indicator-dot input-dot" />
                      Input
                    </td>
                    <td>{tokenUsage.last ? formatTokenCount(lastVisibleInputTokens) : "-"}</td>
                    <td>{formatTokenCount(totalVisibleInputTokens)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="indicator-dot skills-dot" />
                      Skills
                    </td>
                    <td>{tokenUsage.last ? formatTokenCount(lastSkillTokens) : "-"}</td>
                    <td>{formatTokenCount(totalSkillTokens)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="indicator-dot output-dot" />
                      Output
                    </td>
                    <td>{tokenUsage.last ? formatTokenCount(tokenUsage.last.outputTokens) : "-"}</td>
                    <td>{formatTokenCount(tokenUsage.total.outputTokens)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="indicator-dot cache-dot" />
                      Cache Read
                    </td>
                    <td>{tokenUsage.last ? formatTokenCount(lastCacheReadTokens) : "-"}</td>
                    <td>{formatTokenCount(totalCacheReadTokens)}</td>
                  </tr>
                  <tr className="table-row-total">
                    <td>Total</td>
                    <td>{tokenUsage.last ? formatTokenCount(tokenUsage.last.totalTokens) : "-"}</td>
                    <td>{formatTokenCount(tokenUsage.total.totalTokens)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="voice-token-popover-footer">
                <span>Metrics auto-reset when starting a new chat session.</span>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="voice-btn voice-btn--ghost"
          aria-label="New chat"
          onClick={handleNewChat}
        >
          <AddIcon fontSize="small" />
        </button>
        <button
          type="button"
          className="voice-btn voice-btn--ghost"
          aria-label="Hide AI Assistant"
          onClick={() => setShowAiAssistant(false)}
        >
          <CloseIcon fontSize="small" />
        </button>
      </div>

      <div className="voice-chat" ref={chatRef}>
        {historyLoading && <div className="voice-history-loading">Loading conversation...</div>}

        {visibleHistory.map((msg) => (
          <div
            key={msg.id}
            className={`voice-message voice-message--${msg.role === "user" ? "user" : "assistant"}`}
          >
            <div className="voice-message-meta">
              <span>{formatRole(msg.role)}</span>
              <span>{formatTime(msg.createdAt)}</span>
            </div>
            <div className="voice-message-bubble">{msg.text}</div>
          </div>
        ))}

        {omniTranscript && (
          <div className="voice-message voice-message--user voice-message--live">
            <div className="voice-message-meta">
              <span>You</span>
              <span>Live</span>
            </div>
            <div className="voice-message-bubble">{omniTranscript}</div>
          </div>
        )}

        {omniStatus === "processing" && !assistantDraft && (
          <div className="voice-message voice-message--assistant voice-message--live voice-message--thinking">
            <div className="voice-message-meta">
              <span>AI</span>
              <span>Thinking</span>
            </div>
            <div className="voice-message-bubble voice-message-bubble--thinking" aria-label="AI is thinking">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          </div>
        )}

        {assistantDraft && (
          <div className="voice-message voice-message--assistant voice-message--live">
            <div className="voice-message-meta">
              <span>AI</span>
              <span>Live</span>
            </div>
            <div className="voice-message-bubble">{assistantDraft}</div>
          </div>
        )}

        {omniPendingConfirmation && (
          <div className="voice-confirmation">
            <div className="voice-confirmation-text">
              Confirm action: <strong>{omniPendingConfirmation.skill}</strong>?
            </div>
            <div className="voice-confirmation-actions">
              <button type="button" className="voice-confirm-btn" onClick={handleConfirm}>
                Confirm
              </button>
              <button type="button" className="voice-cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {omniError && <div className="voice-error">{omniError}</div>}

        {(isDisabled || micDisabled) && (
          <div className="voice-disabled-indicator">
            {micDisabled ? "Microphone disabled in Settings" : "Voice is disabled"}
          </div>
        )}

        {showEmptyState && !isDisabled && !micDisabled && (
          <div className="voice-empty-state">
            <div className="voice-empty-title">Ask AI with your voice</div>
            <div className="voice-empty-copy">
              Use the mic to talk with the assistant and run tmux actions.
            </div>
          </div>
        )}
      </div>

      <form className="voice-composer" aria-label="AI input" onSubmit={handleTextSubmit}>
        <div className="voice-composer-copy">
          <textarea
            className="voice-input"
            aria-label="Message AI Assistant"
            placeholder={omniComposerText(omniStatus)}
            value={inputText}
            rows={1}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {micCapturing && omniStatus !== "connecting" && (
            <div className="voice-level-bar" aria-hidden="true">
              {audioBars.map((active, i) => (
                <span
                  key={i}
                  className={`voice-level-segment${active ? " voice-level-segment--active" : ""}`}
                />
              ))}
            </div>
          )}
          {omniStatus === "connecting" && (
            <div className="voice-level-bar voice-level-bar--connecting" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <span
                  key={i}
                  className="voice-level-segment voice-level-segment--connecting"
                  style={{ animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
          )}
          {omniStatus === "processing" && (
            <div className="voice-level-bar voice-level-bar--processing" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <span
                  key={i}
                  className="voice-level-segment voice-level-segment--processing"
                  style={{ animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
          )}
        </div>
        <div className="ai-assistant-controls">
          <button
            type="submit"
            className="voice-btn voice-btn--send"
            aria-label="Send message"
            disabled={!inputText.trim() || isDisabled}
          >
            <SendIcon fontSize="small" />
          </button>
          <div className="voice-volume-control-wrapper">
            <button
              type="button"
              className={`voice-btn ${audioMuted ? "voice-btn--muted" : "voice-btn--audio"}`}
              aria-label="Adjust AI voice volume"
              aria-haspopup="true"
              aria-expanded={showVolumePopover}
              onClick={() => setShowVolumePopover(!showVolumePopover)}
              disabled={isDisabled}
            >
              {audioMuted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
            </button>
            {showVolumePopover && (
              <div className="voice-volume-popover" ref={volumePopoverRef} data-testid="voice-volume-popover">
                <div className="voice-volume-header">
                  <span className="voice-volume-pct">{audioMuted ? "—" : `${Math.round(volume * 100)}%`}</span>
                  <button
                    type="button"
                    className={`voice-mute-icon-btn${audioMuted ? " voice-mute-icon-btn--muted" : ""}`}
                    aria-label={audioMuted ? "Unmute AI voice" : "Mute AI voice"}
                    aria-pressed={audioMuted}
                    onClick={handleMuteToggle}
                    disabled={isDisabled}
                  >
                    {audioMuted ? <VolumeOffIcon style={{ fontSize: 16 }} /> : <VolumeUpIcon style={{ fontSize: 16 }} />}
                  </button>
                </div>
                <div className="voice-volume-track-wrap">
                  <div
                    className="voice-volume-track-bg"
                    style={{ "--volume-fill": `${audioMuted ? 0 : volume * 100}%` } as React.CSSProperties}
                  />
                  <input
                    type="range"
                    className="voice-volume-slider-popover"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    disabled={isDisabled}
                    aria-label="Volume level"
                  />
                </div>
              </div>
            )}
          </div>
          {isRunning ? (
            <button
              type="button"
              className="voice-btn voice-btn--stop"
              aria-label={micCapturing ? "Stop listening" : "Stop AI output"}
              onClick={micCapturing ? stopListening : handleStopResponse}
              disabled={isDisabled}
            >
              <StopCircleIcon fontSize="small" />
            </button>
          ) : (
            <button
              type="button"
              className="voice-btn voice-btn--start"
              aria-label="Start listening"
              onClick={omniStatus === "error" ? handleReconnect : startListening}
              disabled={isDisabled || wsConnecting || micDisabled || !micAvailable}
            >
              {isDisabled || micDisabled || !micAvailable ? (
                <MicOffIcon fontSize="small" />
              ) : (
                <MicIcon fontSize="small" />
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
