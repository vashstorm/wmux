import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react"
import type {
  AppConfig,
  ConnectionConfig,
  ConnectionHealth,
  SessionInfoData,
  WindowInfo,
  PaneInfo,
  AiUsageEvent,
  Project,
  OmniConversationMessage,
  AiLogEntry,
} from "../api/client.js"
import { normalizeThemeId } from "../ui/themes.js"
import {
  fontSizeToScaleStep,
  DEFAULT_UI_SCALE_STEP,
  DEFAULT_TERMINAL_FONT_SIZE,
  clampUIScaleStep,
} from "../ui/fontSize.js"

export interface WindowSummary {
  id: string
  name: string
  index: number
  active: boolean
  paneCount: number
  activePaneID: string
  activePaneTitle: string
  attentionState?: "none" | "attention" | "explicit"
  attentionCount?: number
  intelligenceApp?: string
  intelligenceStatus?: string
  intelligenceSummary?: string
  intelligenceSource?: string
  intelligenceConfidence?: number
  intelligenceStale?: boolean
  intelligenceUpdatedAt?: string
  intelligenceError?: string
  intelligenceAppCounts?: Record<string, number>
}

export interface PaneData {
  id: string
  title: string
  index: number
  active: boolean
  width: number
  height: number
  left: number
  top: number
  sourceCols?: number
  sourceRows?: number
  attentionState?: "none" | "attention" | "explicit"
  intelligenceApp?: string
  intelligenceStatus?: string
  intelligenceSummary?: string
  intelligenceSource?: string
  intelligenceConfidence?: number
  intelligenceStale?: boolean
  intelligenceUpdatedAt?: string
  intelligenceError?: string
}

export interface SessionWindowState {
  windows: WindowSummary[]
  loadedPanes: Record<string, PaneData[]>
  panesLoaded: boolean
}

/**
 * Stable ID selectors: window holds a `@window_id`, pane holds a `%pane_id`.
 * These are populated once a session is opened and remain stable across refreshes.
 */
export interface SelectedPane {
  targetName: string
  session: string
  window?: string
  pane?: string
}

type WindowInfoLike = WindowInfo & {
  id?: string
  name?: string
  index?: number
  active?: boolean
  paneCount?: number
  activePaneId?: string
  activePaneTitle?: string
  attentionState?: "none" | "attention" | "explicit"
  attentionCount?: number
  intelligenceApp?: string
  intelligenceStatus?: string
  intelligenceSummary?: string
  intelligenceSource?: string
  intelligenceConfidence?: number
  intelligenceStale?: boolean
  intelligenceUpdatedAt?: string
  intelligenceError?: string
  intelligenceAppCounts?: Record<string, number>
}

type PaneInfoLike = PaneInfo & {
  id?: string
  title?: string
  index?: number
  active?: boolean
  width?: number
  height?: number
  left?: number
  top?: number
  attentionState?: "none" | "attention" | "explicit"
  intelligenceApp?: string
  intelligenceStatus?: string
  intelligenceSummary?: string
  intelligenceSource?: string
  intelligenceConfidence?: number
  intelligenceStale?: boolean
  intelligenceUpdatedAt?: string
  intelligenceError?: string
}

function windowInfoToSummary(w: WindowInfoLike): WindowSummary {
  return {
    id: w.ID ?? w.id ?? "",
    name: w.Name ?? w.name ?? "",
    index: w.Index ?? w.index ?? 0,
    active: w.Active ?? w.active ?? false,
    paneCount: w.PaneCount ?? w.paneCount ?? 0,
    activePaneID: w.ActivePaneID ?? w.activePaneId ?? "",
    activePaneTitle: w.ActivePaneTitle ?? w.activePaneTitle ?? "",
    attentionState: w.AttentionState ?? w.attentionState,
    attentionCount: w.AttentionCount ?? w.attentionCount,
    intelligenceApp: w.IntelligenceApp ?? w.intelligenceApp,
    intelligenceStatus: w.IntelligenceStatus ?? w.intelligenceStatus,
    intelligenceSummary: w.IntelligenceSummary ?? w.intelligenceSummary,
    intelligenceSource: w.IntelligenceSource ?? w.intelligenceSource,
    intelligenceConfidence: w.IntelligenceConfidence ?? w.intelligenceConfidence,
    intelligenceStale: w.IntelligenceStale ?? w.intelligenceStale,
    intelligenceUpdatedAt: w.IntelligenceUpdatedAt ?? w.intelligenceUpdatedAt,
    intelligenceError: w.IntelligenceError ?? w.intelligenceError,
    intelligenceAppCounts: w.IntelligenceAppCounts ?? w.intelligenceAppCounts,
  }
}

function paneInfoToData(p: PaneInfoLike): PaneData {
  return {
    id: p.ID ?? p.id ?? "",
    title: p.Title ?? p.title ?? "",
    index: p.Index ?? p.index ?? 0,
    active: p.Active ?? p.active ?? false,
    width: p.Width ?? p.width ?? 0,
    height: p.Height ?? p.height ?? 0,
    left: p.Left ?? p.left ?? 0,
    top: p.Top ?? p.top ?? 0,
    sourceCols: p.Width ?? p.width ?? 0,
    sourceRows: p.Height ?? p.height ?? 0,
    attentionState: p.AttentionState ?? p.attentionState,
    intelligenceApp: p.IntelligenceApp ?? p.intelligenceApp,
    intelligenceStatus: p.IntelligenceStatus ?? p.intelligenceStatus,
    intelligenceSummary: p.IntelligenceSummary ?? p.intelligenceSummary,
    intelligenceSource: p.IntelligenceSource ?? p.intelligenceSource,
    intelligenceConfidence: p.IntelligenceConfidence ?? p.intelligenceConfidence,
    intelligenceStale: p.IntelligenceStale ?? p.intelligenceStale,
    intelligenceUpdatedAt: p.IntelligenceUpdatedAt ?? p.intelligenceUpdatedAt,
    intelligenceError: p.IntelligenceError ?? p.intelligenceError,
  }
}

function samePaneTopology(current: PaneData[] | undefined, next: PaneData[]) {
  if (!current || current.length !== next.length) return false
  const currentIds = new Set(current.map((pane) => pane.id))
  return next.every((pane) => currentIds.has(pane.id))
}

function preservePaneGeometry(current: PaneData[] | undefined, next: PaneData[]) {
  if (!samePaneTopology(current, next)) {
    return next
  }

  const currentById = new Map(current!.map((pane) => [pane.id, pane]))
  return next.map((pane) => {
    const existing = currentById.get(pane.id)
    if (!existing) return pane
    return {
      ...pane,
      width: existing.width,
      height: existing.height,
      left: existing.left,
      top: existing.top,
    }
  })
}

export type OmniStatus =
  | "disabled"
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "confirming"
  | "speaking"
  | "error"

export interface OmniPendingConfirmation {
  confirmationId: string
  skill: string
  params?: Record<string, unknown>
  callId?: string
}

export interface OmniState {
  omniStatus: OmniStatus
  omniTranscript: string
  omniPendingConfirmation: OmniPendingConfirmation | null
  omniError: string | null
}

export interface UISettings {
  theme: string
  windowTheme: string
  uiScaleStep: number
  terminalFontSize: number
  terminalFontWeight: string
}

export const UI_SETTINGS_STORAGE_KEY = "wmux-ui-settings"

const DEFAULT_UI_SETTINGS: UISettings = {
  theme: "dark",
  windowTheme: "dark",
  uiScaleStep: DEFAULT_UI_SCALE_STEP,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalFontWeight: "normal",
}

function readInitialUISettings(): UISettings {
  if (typeof window === "undefined") return DEFAULT_UI_SETTINGS

  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_UI_SETTINGS

    const parsed = JSON.parse(raw) as Partial<UISettings> & { fontSize?: number }
    const theme = normalizeThemeId(parsed.theme, DEFAULT_UI_SETTINGS.theme)
    const windowTheme = normalizeThemeId(parsed.windowTheme, theme)

    const uiScaleStep = clampUIScaleStep(
      parsed.uiScaleStep !== undefined
        ? parsed.uiScaleStep
        : parsed.fontSize !== undefined
          ? fontSizeToScaleStep(parsed.fontSize)
          : DEFAULT_UI_SCALE_STEP,
    )

    return {
      theme,
      windowTheme,
      uiScaleStep,
      terminalFontSize: parsed.terminalFontSize || DEFAULT_UI_SETTINGS.terminalFontSize,
      terminalFontWeight: parsed.terminalFontWeight || DEFAULT_UI_SETTINGS.terminalFontWeight,
    }
  } catch {
    return DEFAULT_UI_SETTINGS
  }
}

function persistUISettings(settings: UISettings) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage can be unavailable in privacy-restricted contexts.
  }
}

export interface AppState {
  connections: ConnectionConfig[]
  selectedTargetName: string | null
  sessions: Record<string, SessionInfoData[]>
  windows: Record<string, SessionWindowState>
  loading: {
    connections: boolean
    sessions: boolean
    creatingConnection: boolean
    connectionHealth: boolean
  }
  error: { code: string; message: string } | null
  showNewConnectionForm: boolean
  showSettingsPanel: boolean
  showErrorLogsPanel: boolean
  showAiAssistant: boolean
  errorLogCount: number
  configConflict: ConfigConflictState | null
  confirmDialog: ConfirmDialogState | null
  selectedPane: SelectedPane | null
  selectedAiEvent: AiUsageEvent | null
  selectedAiLog: AiLogEntry | null
  selectedProject: Project | null
  connectionHealth: Record<string, ConnectionHealth>
  editingConnection: ConnectionConfig | null
  uiSettings: UISettings
  omniStatus: OmniStatus
  omniTranscript: string
  omniPendingConfirmation: OmniPendingConfirmation | null
  omniError: string | null
  omniHistory: OmniConversationMessage[]
}

export interface ConfigConflictState {
  pendingConfig: AppConfig
  onReload: () => Promise<void>
  onRetry: () => Promise<void>
}

export interface ConfirmDialogState {
  title: string
  message: string
  confirmText: string
  confirmVariant: "danger" | "primary"
  onConfirm: () => void
}

interface AppContextValue extends AppState {
  setConnections: (connections: ConnectionConfig[]) => void
  setSelectedTargetName: (targetName: string | null) => void
  setSessions: (targetName: string, sessions: SessionInfoData[]) => void
  updateSession: (
    targetName: string,
    sessionName: string,
    updates: Partial<SessionInfoData>,
  ) => void
  setWindows: (targetName: string, session: string, windows: WindowInfo[]) => void
  setPanes: (targetName: string, session: string, windowId: string, panes: PaneInfo[]) => void
  setLoading: (key: keyof AppState["loading"], value: boolean) => void
  setError: (error: { code: string; message: string } | null) => void
  setShowNewConnectionForm: (show: boolean) => void
  setShowSettingsPanel: (show: boolean) => void
  setShowErrorLogsPanel: (show: boolean) => void
  setShowAiAssistant: (show: boolean) => void
  setErrorLogCount: (count: number) => void
  setConfigConflict: (conflict: ConfigConflictState | null) => void
  setConfirmDialog: (dialog: ConfirmDialogState | null) => void
  showConfirm: (options: Omit<ConfirmDialogState, "onConfirm"> & { onConfirm: () => void }) => void
  setSelectedPane: (pane: SelectedPane | null) => void
  setSelectedAiEvent: (event: AiUsageEvent | null) => void
  setSelectedAiLog: (log: AiLogEntry | null) => void
  setSelectedProject: (project: Project | null) => void
  setConnectionHealth: (health: Record<string, ConnectionHealth>) => void
  setEditingConnection: (connection: ConnectionConfig | null) => void
  setUISettings: (settings: UISettings) => void
  setOmniStatus: (status: OmniStatus) => void
  appendVoiceTranscript: (text: string) => void
  setOmniTranscript: (text: string) => void
  setOmniConfirmation: (confirmation: OmniPendingConfirmation | null) => void
  setOmniError: (error: string | null) => void
  setOmniHistory: (history: OmniConversationMessage[]) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [connections, setConnectionsState] = useState<ConnectionConfig[]>([])
  const [selectedTargetName, setSelectedTargetName] = useState<string | null>(null)
  const [sessions, setSessionsState] = useState<Record<string, SessionInfoData[]>>({})
  const [windows, setWindowsState] = useState<AppState["windows"]>({})
  const [loading, setLoadingState] = useState<AppState["loading"]>({
    connections: false,
    sessions: false,
    creatingConnection: false,
    connectionHealth: false,
  })
  const [error, setErrorState] = useState<AppState["error"]>(null)
  const [showNewConnectionForm, setShowNewConnectionForm] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [showErrorLogsPanel, setShowErrorLogsPanel] = useState(false)
  const [showAiAssistant, setShowAiAssistantState] = useState(false)
  const [errorLogCount, setErrorLogCount] = useState(0)
  const [configConflict, setConfigConflict] = useState<ConfigConflictState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [selectedPane, setSelectedPaneState] = useState<SelectedPane | null>(null)
  const [selectedAiEvent, setSelectedAiEventState] = useState<AiUsageEvent | null>(null)
  const [selectedAiLog, setSelectedAiLogState] = useState<AiLogEntry | null>(null)
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(null)
  const [connectionHealth, setConnectionHealth] = useState<Record<string, ConnectionHealth>>({})
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null)
  const [uiSettings, setUISettingsState] = useState<UISettings>(readInitialUISettings)
  const [omniStatus, setOmniStatusState] = useState<OmniStatus>("disabled")
  const [omniTranscript, setOmniTranscriptState] = useState("")
  const [omniPendingConfirmation, setOmniConfirmationState] =
    useState<OmniPendingConfirmation | null>(null)
  const [omniError, setOmniErrorState] = useState<string | null>(null)
  const [omniHistory, setOmniHistoryState] = useState<OmniConversationMessage[]>([])

  const setConnections = useCallback((newConnections: ConnectionConfig[]) => {
    setConnectionsState(newConnections)
  }, [])

  const setSessions = useCallback((targetName: string, newSessions: SessionInfoData[]) => {
    setSessionsState((prev) => ({ ...prev, [targetName]: newSessions }))
  }, [])

  const updateSession = useCallback(
    (targetName: string, sessionName: string, updates: Partial<SessionInfoData>) => {
      setSessionsState((prev) => ({
        ...prev,
        [targetName]: (prev[targetName] ?? []).map((s) =>
          s.name === sessionName ? { ...s, ...updates } : s,
        ),
      }))
    },
    [],
  )

  const setWindows = useCallback(
    (targetName: string, session: string, newWindows: WindowInfo[]) => {
      const key = `${targetName}:${session}`
      setWindowsState((prev) => {
        const existing = prev[key]
        return {
          ...prev,
          [key]: {
            windows: newWindows.map(windowInfoToSummary),
            loadedPanes: existing?.loadedPanes ?? {},
            panesLoaded: existing?.panesLoaded ?? false,
          },
        }
      })
    },
    [],
  )

  const setPanes = useCallback(
    (targetName: string, session: string, windowId: string, newPanes: PaneInfo[]) => {
      const key = `${targetName}:${session}`
      setWindowsState((prev) => {
        const existing = prev[key]
        const nextPanes = newPanes.map(paneInfoToData)
        return {
          ...prev,
          [key]: {
            windows: existing?.windows ?? [],
            loadedPanes: {
              ...(existing?.loadedPanes ?? {}),
              [windowId]: preservePaneGeometry(existing?.loadedPanes[windowId], nextPanes),
            },
            panesLoaded: true,
          },
        }
      })
    },
    [],
  )

  const setLoading = useCallback((key: keyof AppState["loading"], value: boolean) => {
    setLoadingState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const setError = useCallback((err: { code: string; message: string } | null) => {
    setErrorState(err)
  }, [])

  const showConfirm = useCallback(
    (options: Omit<ConfirmDialogState, "onConfirm"> & { onConfirm: () => void }) => {
      setConfirmDialog({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText,
        confirmVariant: options.confirmVariant,
        onConfirm: options.onConfirm,
      })
    },
    [],
  )

  const setUISettings = useCallback((settings: UISettings) => {
    persistUISettings(settings)
    setUISettingsState(settings)
  }, [])

  const setOmniStatus = useCallback((status: OmniStatus) => {
    setOmniStatusState(status)
  }, [])

  const setOmniTranscript = useCallback((text: string) => {
    setOmniTranscriptState(text)
  }, [])

  const appendVoiceTranscript = useCallback((text: string) => {
    setOmniTranscriptState((prev) => prev + text)
  }, [])

  const setOmniConfirmation = useCallback((confirmation: OmniPendingConfirmation | null) => {
    setOmniConfirmationState(confirmation)
  }, [])

  const setOmniError = useCallback((error: string | null) => {
    setOmniErrorState(error)
  }, [])

  const setOmniHistory = useCallback((history: OmniConversationMessage[]) => {
    setOmniHistoryState(history)
  }, [])

  const setShowAiAssistant = useCallback((show: boolean) => {
    setShowAiAssistantState(show)
  }, [])

  const setSelectedPane = useCallback((pane: SelectedPane | null) => {
    setSelectedPaneState(pane)
    if (pane !== null) {
      setSelectedAiEventState(null)
      setSelectedAiLogState(null)
      setSelectedProjectState(null)
    }
  }, [])

  const setSelectedAiEvent = useCallback((event: AiUsageEvent | null) => {
    setSelectedAiEventState(event)
    if (event !== null) {
      setSelectedPaneState(null)
      setSelectedAiLogState(null)
      setSelectedProjectState(null)
    }
  }, [])

  const setSelectedAiLog = useCallback((log: AiLogEntry | null) => {
    setSelectedAiLogState(log)
    if (log !== null) {
      setSelectedPaneState(null)
      setSelectedAiEventState(null)
      setSelectedProjectState(null)
    }
  }, [])

  const setSelectedProject = useCallback((project: Project | null) => {
    setSelectedProjectState(project)
    if (project !== null) {
      setSelectedPaneState(null)
      setSelectedAiEventState(null)
      setSelectedAiLogState(null)
    }
  }, [])

  const value = useMemo(
    () => ({
      connections,
      selectedTargetName,
      sessions,
      windows,
      loading,
      error,
      showNewConnectionForm,
      showSettingsPanel,
      showErrorLogsPanel,
      showAiAssistant,
      errorLogCount,
      configConflict,
      confirmDialog,
      selectedPane,
      selectedAiEvent,
      selectedAiLog,
      selectedProject,
      connectionHealth,
      editingConnection,
      setConnections,
      setSelectedTargetName,
      setSessions,
      updateSession,
      setWindows,
      setPanes,
      setLoading,
      setError,
      setShowNewConnectionForm,
      setShowSettingsPanel,
      setShowErrorLogsPanel,
      setShowAiAssistant,
      setErrorLogCount,
      setConfigConflict,
      setConfirmDialog,
      showConfirm,
      setSelectedPane,
      setSelectedAiEvent,
      setSelectedAiLog,
      setSelectedProject,
      setConnectionHealth,
      setEditingConnection,
      uiSettings,
      setUISettings,
      omniStatus,
      omniTranscript,
      omniPendingConfirmation,
      omniError,
      omniHistory,
      setOmniStatus,
      appendVoiceTranscript,
      setOmniTranscript,
      setOmniConfirmation,
      setOmniError,
      setOmniHistory,
    }),
    [
      connections,
      selectedTargetName,
      sessions,
      windows,
      loading,
      error,
      showNewConnectionForm,
      showSettingsPanel,
      showErrorLogsPanel,
      showAiAssistant,
      errorLogCount,
      configConflict,
      confirmDialog,
      selectedPane,
      selectedAiEvent,
      selectedAiLog,
      selectedProject,
      connectionHealth,
      editingConnection,
      setConnections,
      setSelectedTargetName,
      setSessions,
      updateSession,
      setWindows,
      setPanes,
      setLoading,
      setError,
      setShowNewConnectionForm,
      setShowSettingsPanel,
      setShowErrorLogsPanel,
      setShowAiAssistant,
      setErrorLogCount,
      setConfigConflict,
      setConfirmDialog,
      showConfirm,
      setSelectedPane,
      setSelectedAiEvent,
      setSelectedAiLog,
      setSelectedProject,
      setConnectionHealth,
      setEditingConnection,
      uiSettings,
      setUISettings,
      omniStatus,
      omniTranscript,
      omniPendingConfirmation,
      omniError,
      omniHistory,
      setOmniStatus,
      appendVoiceTranscript,
      setOmniTranscript,
      setOmniConfirmation,
      setOmniError,
      setOmniHistory,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppState(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useAppState must be used within an AppProvider")
  }
  return context
}

export function useSelectedConnection(): ConnectionConfig | null {
  const { connections, selectedTargetName } = useAppState()
  return connections.find((c) => c.targetName === selectedTargetName) ?? null
}
