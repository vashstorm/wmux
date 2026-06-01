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
import CloseIcon from "@mui/icons-material/Close"
import AddIcon from "@mui/icons-material/Add"
import SendIcon from "@mui/icons-material/Send"
import { getAuthToken, getRuntimeFlags } from "../api/runtime.js"
import { OmniWebSocket } from "../api/voiceClient.js"
import { AudioPipeline } from "../api/audioPipeline.js"
import type { OmniServerEvent, VoiceSessionContextMessage } from "../api/voiceTypes.js"
import {
  isVoiceAudioDeltaEvent,
  isVoiceTranscriptDeltaEvent,
  isVoiceTranscriptDoneEvent,
  isVoiceIntentReceivedEvent,
  isVoiceActionResultEvent,
  isVoiceErrorEvent,
  isVoiceConnectedEvent,
  isVoiceAssistantMessageEvent,
} from "../api/voiceTypes.js"
import { useAppState } from "../state/store.js"
import {
  getConfig,
  getOmniHistory,
  clearOmniHistory,
  type OmniConversationMessage,
} from "../api/client.js"
import "../styles/ai-assistant.css"

const LEVEL_SEGMENTS = 12
const AUDIO_PIPELINE_CONFIG = {
  sampleRateInput: 16000,
  sampleRateOutput: 24000,
  vadEnabled: false,
  vadThreshold: 0,
}
const ASSISTANT_SIZE_STORAGE_KEY = "wmux-ai-assistant-size"
export const LAUNCHER_POS_STORAGE_KEY = "wmux-launcher-pos"
const DEFAULT_ASSISTANT_SIZE = { width: 380, height: 520 }
const MIN_ASSISTANT_SIZE = { width: 320, height: 360 }
const LAUNCHER_ELEM_SIZE = { width: 42, height: 42 }
const VIEWPORT_MARGIN_PX = 16

type AssistantSize = typeof DEFAULT_ASSISTANT_SIZE
export type AssistantPos = { x: number; y: number }
type ResizeStart = {
  pointerId: number | "mouse"
  startX: number
  startY: number
  startWidth: number
  startHeight: number
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

export function clampAssistantPos(
  pos: AssistantPos,
  size: { width: number; height: number },
): AssistantPos {
  if (typeof window === "undefined") return pos
  const maxX = window.innerWidth - size.width - VIEWPORT_MARGIN_PX
  const maxY = window.innerHeight - size.height - VIEWPORT_MARGIN_PX
  return {
    x: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxY, pos.y))),
  }
}

function defaultLauncherPos(): AssistantPos {
  if (typeof window === "undefined") return { x: VIEWPORT_MARGIN_PX, y: VIEWPORT_MARGIN_PX }
  return {
    x: window.innerWidth - LAUNCHER_ELEM_SIZE.width - VIEWPORT_MARGIN_PX,
    y: window.innerHeight - LAUNCHER_ELEM_SIZE.height - VIEWPORT_MARGIN_PX,
  }
}

export function loadLauncherPos(): AssistantPos {
  try {
    const raw = localStorage.getItem(LAUNCHER_POS_STORAGE_KEY)
    if (!raw) return defaultLauncherPos()
    const parsed = JSON.parse(raw) as Partial<AssistantPos>
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return defaultLauncherPos()
    }
    return clampAssistantPos({ x: parsed.x, y: parsed.y }, LAUNCHER_ELEM_SIZE)
  } catch {
    return defaultLauncherPos()
  }
}

export function saveLauncherPos(pos: AssistantPos): void {
  try {
    localStorage.setItem(LAUNCHER_POS_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
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

/** Compute where the dialog should open, anchoring to the launcher and expanding toward the screen center. */
function dialogPosFromLauncher(
  launcherPos: AssistantPos,
  dialogSize: { width: number; height: number },
): AssistantPos {
  if (typeof window === "undefined") return { x: VIEWPORT_MARGIN_PX, y: VIEWPORT_MARGIN_PX }
  const iconCenterX = launcherPos.x + LAUNCHER_ELEM_SIZE.width / 2
  const iconCenterY = launcherPos.y + LAUNCHER_ELEM_SIZE.height / 2
  // Align the dialog edge that is closest to the nearest screen edge with the icon's same edge.
  // This makes the dialog expand toward the screen center.
  const x =
    iconCenterX > window.innerWidth / 2
      ? launcherPos.x + LAUNCHER_ELEM_SIZE.width - dialogSize.width // right half → right-align
      : launcherPos.x // left half  → left-align
  const y =
    iconCenterY > window.innerHeight / 2
      ? launcherPos.y + LAUNCHER_ELEM_SIZE.height - dialogSize.height // bottom half → bottom-align
      : launcherPos.y // top half    → top-align
  return clampAssistantPos({ x, y }, dialogSize)
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
    setShowSettingsPanel,
    setShowAiAssistant,
    connections,
    selectedTargetName,
    selectedPane,
  } = useAppState()

  const audioLevel = useRef(0)
  const [audioBars, setAudioBars] = useState<boolean[]>(new Array(LEVEL_SEGMENTS).fill(false))
  const wsRef = useRef<OmniWebSocket | null>(null)
  const pipelineRef = useRef<AudioPipeline | null>(null)
  const wsConnectingRef = useRef(false)
  const omniStatusRef = useRef(omniStatus)
  const [wsConnecting, setWsConnecting] = useState(false)
  const [micCapturing, setMicCapturing] = useState(false)
  const [micDisabled, setMicDisabled] = useState(false)
  const [micAvailable, setMicAvailable] = useState(() => getRuntimeFlags().omniAvailable)
  const [history, setHistory] = useState<OmniConversationMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inputText, setInputText] = useState("")
  const [assistantSize, setAssistantSize] = useState(loadAssistantSize)
  const [assistantPos, setAssistantPos] = useState<AssistantPos>(() =>
    dialogPosFromLauncher(loadLauncherPos(), loadAssistantSize()),
  )
  const chatRef = useRef<HTMLDivElement | null>(null)
  const resizeStartRef = useRef<ResizeStart | null>(null)
  const dragStartRef = useRef<DragStart | null>(null)

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
    (ws: OmniWebSocket) => {
      const context = buildSessionContextMessage()
      if (context) {
        ws.send(context)
      }
    },
    [buildSessionContextMessage],
  )

  useEffect(() => {
    omniStatusRef.current = omniStatus
  }, [omniStatus])
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
    setHistory([])
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
    [assistantSize],
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
      setAssistantSize(nextSize)
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
      return current
    })
  }, [])

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

      if (isVoiceTranscriptDoneEvent(event)) {
        setOmniTranscript("")
        setOmniStatus("processing")
        setHistory((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-user`,
            conversationId: "default",
            role: "user",
            kind: "transcript",
            text: event.text,
            createdAt: new Date().toISOString(),
          },
        ])
        return
      }

      if (isVoiceIntentReceivedEvent(event)) {
        if (event.skill === "navigate_frontend") {
          const route = typeof event.params.route === "string" ? event.params.route : ""
          if (route === "settings") {
            setShowSettingsPanel(true)
            window.history.pushState(null, "", `${window.location.pathname}?view=settings`)
          } else {
            window.dispatchEvent(new CustomEvent("wmux:navigate-sidebar", { detail: { route } }))
          }
        }
        if (event.confirmationRequired && event.confirmationId) {
          setOmniConfirmation({
            confirmationId: event.confirmationId,
            skill: event.skill,
          })
          setOmniStatus("confirming")
        } else {
          setOmniStatus("processing")
        }
        return
      }

      if (isVoiceActionResultEvent(event)) {
        setOmniConfirmation(null)
        if (event.success) {
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

      if (isVoiceAssistantMessageEvent(event)) {
        setOmniStatus("idle")
        setHistory((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}-assistant-message`,
            conversationId: "default",
            role: "assistant",
            kind: "assistant_text",
            text: event.text,
            createdAt: new Date().toISOString(),
          },
        ])
        return
      }

      if (isVoiceAudioDeltaEvent(event)) {
        setOmniStatus("speaking")
        pipelineRef.current?.enqueuePlayback(event.pcm16Base64, event.sampleRate)
        return
      }

      if (isVoiceErrorEvent(event)) {
        setOmniError(event.message)
        setOmniStatus("error")
      }
    },
    [
      appendVoiceTranscript,
      setOmniTranscript,
      setOmniConfirmation,
      setOmniError,
      setOmniStatus,
      setShowSettingsPanel,
    ],
  )

  const connectVoice = useCallback(() => {
    if (wsConnectingRef.current || wsRef.current) return

    const token = getAuthToken() ?? ""

    wsConnectingRef.current = true
    setWsConnecting(true)
    omniStatusRef.current = "connecting"
    setOmniStatus("connecting")
    setOmniTranscript("")
    setOmniError(null)

    const ws = new OmniWebSocket({
      token,
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
        if (omniStatusRef.current !== "disabled") {
          setOmniStatus("idle")
        }
        wsRef.current = null
      },
      onError: () => {
        wsConnectingRef.current = false
        setWsConnecting(false)
        setOmniError("Connection failed")
        setOmniStatus("error")
      },
    })

    sendSessionContext(ws)
    ws.connect()
    wsRef.current = ws
  }, [handleServerMessage, sendSessionContext, setOmniStatus, setOmniTranscript, setOmniError])

  const startListening = useCallback(async () => {
    if (micDisabled) return
    if (!micAvailable) {
      setOmniError("Microphone is unavailable in this browser")
      setOmniStatus("error")
      return
    }

    connectVoice()

    if (!pipelineRef.current) {
      pipelineRef.current = createAudioPipeline()
    }

    try {
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
      setOmniError(null)
    } catch {
      setMicCapturing(false)
      setOmniError("Microphone access denied")
      setOmniStatus("error")
    }
  }, [connectVoice, setOmniTranscript, setOmniError, setOmniStatus, micDisabled, micAvailable])

  const stopListening = useCallback(() => {
    pipelineRef.current?.stopCapture()
    pipelineRef.current?.stopPlayback()
    wsRef.current?.close()
    wsRef.current = null
    wsConnectingRef.current = false
    setWsConnecting(false)
    setMicCapturing(false)
    setAudioBars(new Array(LEVEL_SEGMENTS).fill(false))
    setOmniStatus("idle")
  }, [setOmniStatus])

  const handleConfirm = useCallback(() => {
    if (omniPendingConfirmation && wsRef.current?.isConnected()) {
      wsRef.current.send({
        type: "confirm_action",
        confirmationId: omniPendingConfirmation.confirmationId,
      })
    }
  }, [omniPendingConfirmation])

  const handleCancel = useCallback(() => {
    if (omniPendingConfirmation && wsRef.current?.isConnected()) {
      wsRef.current.send({
        type: "cancel_action",
        confirmationId: omniPendingConfirmation.confirmationId,
      })
    }
    setOmniConfirmation(null)
    setOmniStatus("listening")
  }, [omniPendingConfirmation, setOmniConfirmation, setOmniStatus])

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
      setOmniError(null)
      omniStatusRef.current = "processing"
      setOmniStatus("processing")
      if (existingWs) {
        sendSessionContext(wsRef.current)
      }
      wsRef.current.send({ type: "text_message", text })
    },
    [connectVoice, inputText, sendSessionContext, setOmniError, setOmniStatus, setOmniTranscript],
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
      setAssistantPos((prev) => {
        const size = loadAssistantSize()
        return clampAssistantPos({ x: drag.baseX + dx, y: drag.baseY + dy }, size)
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
    // Dialog position is session-only; not persisted (reopening always re-anchors to launcher)
  }, [])

  useEffect(() => {
    const handleWindowResize = () => {
      setAssistantSize((current) => clampAssistantSize(current))
      setAssistantPos((current) => clampAssistantPos(current, loadAssistantSize()))
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
  const isDisabled = omniStatus === "disabled"
  const visibleHistory = history.slice(-10)
  const latestHistoryId = history[history.length - 1]?.id ?? ""
  const showEmptyState =
    !historyLoading &&
    visibleHistory.length === 0 &&
    !omniTranscript &&
    !omniError &&
    !omniPendingConfirmation
  const handleMicToggle = micCapturing
    ? stopListening
    : omniStatus === "error"
      ? handleReconnect
      : startListening

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
          e.currentTarget.setPointerCapture(e.pointerId)
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
          <span>{omniStatus}</span>
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
          {(micCapturing || omniStatus === "connecting") && (
            <div className="voice-level-bar" aria-hidden="true">
              {audioBars.map((active, i) => (
                <span
                  key={i}
                  className={`voice-level-segment${active ? " voice-level-segment--active" : ""}`}
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
          <button
            type="button"
            className={`voice-btn ${micCapturing ? "voice-btn--stop" : "voice-btn--start"}`}
            aria-label={micCapturing ? "Stop listening" : "Start listening"}
            onClick={handleMicToggle}
            disabled={!micCapturing && (isDisabled || wsConnecting || micDisabled || !micAvailable)}
          >
            {micCapturing ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </button>
        </div>
      </form>
    </div>
  )
}
