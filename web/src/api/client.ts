import { invoke } from "@tauri-apps/api/core"
import { ApiError, type ApiErrorResponse } from "./errors.js"

async function ipcInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    const errMsg = err.message || String(e)
    const codeMatch = errMsg.match(/^(\w+):/)
    const code = codeMatch?.[1] || err.code || "internal_error"
    const message = codeMatch ? errMsg.substring(codeMatch[0]!.length + 1) : errMsg
    throw new ApiError(code, message.trim(), 500)
  }
}

export interface ConnectionConfig {
  id?: string
  targetName: string
  type: string
  host?: string
  port?: number
  user?: string
  privateKeyPath?: string
  knownHostsPath?: string
}

export function connectionDisplayName(conn: ConnectionConfig): string {
  if (conn.type === "local") {
    return "local"
  }
  return conn.host ?? conn.targetName
}

type RawConnectionConfig = Omit<Partial<ConnectionConfig>, "targetName"> & {
  id?: string
  targetName?: string
}

function normalizeConnectionConfig(conn: RawConnectionConfig): ConnectionConfig {
  const targetName = conn.targetName ?? conn.id ?? ""
  return {
    id: conn.id ?? targetName,
    targetName,
    type: conn.type ?? "local",
    host: conn.host,
    port: conn.port,
    user: conn.user,
    privateKeyPath: conn.privateKeyPath,
    knownHostsPath: conn.knownHostsPath,
  }
}

function toConfigConnectionPayload(conn: ConnectionConfig): RawConnectionConfig {
  return {
    id: conn.id ?? conn.targetName,
    type: conn.type,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    privateKeyPath: conn.privateKeyPath,
    knownHostsPath: conn.knownHostsPath,
  }
}

function normalizeAppConfig(config: RawAppConfig): AppConfig {
  const { voice, ...rest } = config
  const omni = config.omni ?? voice
  return {
    ...rest,
    omni,
    path: config.path ?? ".",
    connections: (config.connections ?? [])
      .map(normalizeConnectionConfig)
      .filter((connection) => connection.targetName.length > 0),
  }
}

function toConfigPayload(
  config: AppConfig,
): Omit<AppConfig, "connections"> & { connections: RawConnectionConfig[] } {
  return {
    ...config,
    connections: (config.connections ?? []).map(toConfigConnectionPayload),
  }
}

// Raw config format from API (may have legacy field names)
type RawAppConfig = AppConfig & {
  voice?: OmniConfig // legacy alias for omni
}

export interface ConnectionsListResponse {
  data: ConnectionConfig[]
}

export interface SessionInfo {
  ID?: string
  Name?: string
  Attached?: boolean
  id?: string
  name?: string
  attached?: boolean
}

export interface SessionInfoData {
  id?: string
  name?: string
  attached?: boolean
  windowCount?: number
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

export interface SessionsListResponse {
  targetName: string
  mode: string
  adapterPath?: string
  data: SessionInfoData[]
}

export interface OperationResponse {
  targetName: string
  session?: string
  window?: string
  pane?: string
  operation: string
  mode: string
  adapterPath?: string
  status: string
}

export interface HealthResponse {
  status: string
}

export interface IntelligenceProviderConfig {
  name: string
  provider: string
  model: string
  baseURL?: string
  apiKeyConfigured?: boolean
  apiKey?: string
}

export interface IntelligenceConfig {
  enabled: boolean
  activeProvider?: string
  providers: IntelligenceProviderConfig[]
  maxBytes: number
  timeoutSec: number
  minSessionIntervalSec: number
  maxConcurrency: number
  cacheTTLSec: number
}

export interface AppConfig {
  schemaVersion: number
  path: string
  server: {
    bind: string
  }
  auth: {
    token: string
    tokenConfigured?: boolean
  }
  tmux: {
    path: string
  }
  connections: ConnectionConfig[]
  ui: {
    theme: string
    windowTheme: string
    uiScaleStep?: number
    fontSize?: number
    terminalFontSize: number
    terminalFontWeight: string
  }
  intelligence: IntelligenceConfig
  logs?: {
    level: string
    rotationSizeBytes?: number
    retentionDays?: number
  }
  omni?: OmniConfig
}

export interface OmniSkillDef {
  id: string
  name: string
  enabled: boolean
  description: string
  fullPrompt?: string
  sourceFile?: string
  sourceOrder?: number
}

export interface OmniConfig {
  enabled: boolean
  dashscopeApiKeyConfigured?: boolean
  dashscopeApiKey?: string
  microphoneDisabled: boolean
  voice?: string
  skillDefinitions?: OmniSkillDef[]
  model: string
  endpoint: string
  continuousListening: boolean
  storeRawAudio: boolean
  auditLogPath?: string
  vadEnabled: boolean
  vadThreshold: number
}

export interface OmniConversationMessage {
  id: string
  conversationId: string
  role: string
  kind: string
  text: string
  eventJson?: string
  targetName?: string
  sessionName?: string
  windowName?: string
  paneIndex?: number
  createdAt: string
}

export interface OmniHistoryListResponse {
  data: OmniConversationMessage[]
}

export interface ErrorLogsResponse {
  enabled: boolean
  path?: string | null
  lines: string[]
  truncated: boolean
  maxLines: number
}

export interface SkillsListResponse {
  data: OmniSkillDef[]
}

// --- Projects ---

export interface Project {
  id: string
  name: string
  path: string
  description: string
  createdAt: string
  updatedAt: string
  sessionName: string
  status: string
  workdir: string
  layoutJson: string
  detailsJson: string
  progressJson: string
  aiHtml: string
  aiStatus: string
  aiError: string
  lastSyncedAt: string | null
  schemaVersion: number
}

export interface ProjectListResponse {
  data: Project[]
}

export interface NewProject {
  name: string
  path?: string
  description?: string
  sessionName?: string
  workdir?: string
  layoutJson?: string
  detailsJson?: string
  progressJson?: string
}

export interface UpdateProject {
  name?: string
  path?: string
  description?: string
  sessionName?: string
  workdir?: string
  layoutJson?: string
  detailsJson?: string
  progressJson?: string
}

export interface ProjectActionResponse {
  project: Project
  operation: string
}

// --- AI Stats ---

export interface AiUsageEvent {
  id: string
  projectId?: string | null
  provider: string
  model: string
  targetName: string
  sessionName: string
  status: string
  durationMs: number
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
  estimatedCost?: number | null
  errorMessage?: string | null
  windowNumber?: number | null
  responseJson?: string | null
  createdAt: string
}

export interface AiUsageSummary {
  totalEvents: number
  totalSuccess: number
  totalError: number
  totalDurationMs: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalEstimatedCost: number
}

export interface AiStatsResponse {
  data: AiUsageEvent[]
  summary: AiUsageSummary
}

export interface AiStatsCleanupResponse {
  deleted: number
}

export async function fetchHealth(): Promise<HealthResponse> {
  return (await ipcInvoke<HealthResponse>("get_health"))!
}

export async function listSkills(): Promise<OmniSkillDef[]> {
  return (await ipcInvoke<OmniSkillDef[]>("list_skills"))!
}

export async function getSkill(id: string): Promise<OmniSkillDef> {
  return (await ipcInvoke<OmniSkillDef>("get_skill", { id }))!
}

export async function createSkill(skill: OmniSkillDef): Promise<OmniSkillDef> {
  return (await ipcInvoke<OmniSkillDef>("create_skill", { skill }))!
}

export async function updateSkill(id: string, skill: OmniSkillDef): Promise<OmniSkillDef> {
  return (await ipcInvoke<OmniSkillDef>("update_skill", { id, skill }))!
}

export async function deleteSkill(id: string): Promise<void> {
  await ipcInvoke<void>("delete_skill", { id })
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  const response = (await ipcInvoke<RawConnectionConfig[]>("list_connections"))!
  return (response ?? [])
    .map(normalizeConnectionConfig)
    .filter((connection) => connection.targetName.length > 0)
}

export async function createConnection(
  data: Omit<ConnectionConfig, "targetName">,
): Promise<ConnectionConfig> {
  return normalizeConnectionConfig(
    (await ipcInvoke<RawConnectionConfig>("create_connection", { connection: data }))!,
  )
}

export async function getConnection(targetName: string): Promise<ConnectionConfig> {
  return normalizeConnectionConfig(
    (await ipcInvoke<RawConnectionConfig>("get_connection", { id: targetName }))!,
  )
}

export async function updateConnection(
  targetName: string,
  data: ConnectionConfig,
): Promise<ConnectionConfig> {
  return normalizeConnectionConfig(
    (await ipcInvoke<RawConnectionConfig>("update_connection", {
      id: targetName,
      connection: data,
    }))!,
  )
}

export async function deleteConnection(targetName: string): Promise<void> {
  await ipcInvoke<void>("delete_connection", { id: targetName })
}

export interface WindowInfo {
  ID: string
  Name: string
  Index: number
  Active: boolean
  PaneCount: number
  ActivePaneID: string
  ActivePaneTitle: string
  AttentionState?: "none" | "attention" | "explicit"
  AttentionCount?: number
  IntelligenceApp?: string
  IntelligenceStatus?: string
  IntelligenceSummary?: string
  IntelligenceSource?: string
  IntelligenceConfidence?: number
  IntelligenceStale?: boolean
  IntelligenceUpdatedAt?: string
  IntelligenceError?: string
  IntelligenceAppCounts?: Record<string, number>
}

type RawWindowInfo = Partial<WindowInfo> & {
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

export interface WindowsListResponse {
  targetName: string
  session: string
  mode: string
  adapterPath?: string
  data: WindowInfo[]
}

export interface PaneInfo {
  ID: string
  Title: string
  Index: number
  Active: boolean
  Width: number
  Height: number
  Left: number
  Top: number
  AttentionState?: "none" | "attention" | "explicit"
  IntelligenceApp?: string
  IntelligenceStatus?: string
  IntelligenceSummary?: string
  IntelligenceSource?: string
  IntelligenceConfidence?: number
  IntelligenceStale?: boolean
  IntelligenceUpdatedAt?: string
  IntelligenceError?: string
}

type RawPaneInfo = Partial<PaneInfo> & {
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

export interface PanesListResponse {
  targetName: string
  session: string
  window: string
  mode: string
  adapterPath?: string
  data: PaneInfo[]
}

function normalizeWindowInfo(window: RawWindowInfo): WindowInfo {
  return {
    ID: window.ID ?? window.id ?? "",
    Name: window.Name ?? window.name ?? "",
    Index: window.Index ?? window.index ?? 0,
    Active: window.Active ?? window.active ?? false,
    PaneCount: window.PaneCount ?? window.paneCount ?? 0,
    ActivePaneID: window.ActivePaneID ?? window.activePaneId ?? "",
    ActivePaneTitle: window.ActivePaneTitle ?? window.activePaneTitle ?? "",
    AttentionState: window.AttentionState ?? window.attentionState,
    AttentionCount: window.AttentionCount ?? window.attentionCount,
    IntelligenceApp: window.IntelligenceApp ?? window.intelligenceApp,
    IntelligenceStatus: window.IntelligenceStatus ?? window.intelligenceStatus,
    IntelligenceSummary: window.IntelligenceSummary ?? window.intelligenceSummary,
    IntelligenceSource: window.IntelligenceSource ?? window.intelligenceSource,
    IntelligenceConfidence: window.IntelligenceConfidence ?? window.intelligenceConfidence,
    IntelligenceStale: window.IntelligenceStale ?? window.intelligenceStale,
    IntelligenceUpdatedAt: window.IntelligenceUpdatedAt ?? window.intelligenceUpdatedAt,
    IntelligenceError: window.IntelligenceError ?? window.intelligenceError,
    IntelligenceAppCounts: window.IntelligenceAppCounts ?? window.intelligenceAppCounts,
  }
}

function normalizePaneInfo(pane: RawPaneInfo): PaneInfo {
  return {
    ID: pane.ID ?? pane.id ?? "",
    Title: pane.Title ?? pane.title ?? "",
    Index: pane.Index ?? pane.index ?? 0,
    Active: pane.Active ?? pane.active ?? false,
    Width: pane.Width ?? pane.width ?? 0,
    Height: pane.Height ?? pane.height ?? 0,
    Left: pane.Left ?? pane.left ?? 0,
    Top: pane.Top ?? pane.top ?? 0,
    AttentionState: pane.AttentionState ?? pane.attentionState,
    IntelligenceApp: pane.IntelligenceApp ?? pane.intelligenceApp,
    IntelligenceStatus: pane.IntelligenceStatus ?? pane.intelligenceStatus,
    IntelligenceSummary: pane.IntelligenceSummary ?? pane.intelligenceSummary,
    IntelligenceSource: pane.IntelligenceSource ?? pane.intelligenceSource,
    IntelligenceConfidence: pane.IntelligenceConfidence ?? pane.intelligenceConfidence,
    IntelligenceStale: pane.IntelligenceStale ?? pane.intelligenceStale,
    IntelligenceUpdatedAt: pane.IntelligenceUpdatedAt ?? pane.intelligenceUpdatedAt,
    IntelligenceError: pane.IntelligenceError ?? pane.intelligenceError,
  }
}

type WindowsListRawResponse = Omit<WindowsListResponse, "data"> & { data?: RawWindowInfo[] }

export async function listWindows(
  targetName: string,
  sessionName: string,
): Promise<WindowsListResponse> {
  const response = (await ipcInvoke<WindowsListRawResponse>("list_windows", {
    target: targetName,
    session: sessionName,
  }))!
  return {
    ...response,
    data: (response.data ?? []).map(normalizeWindowInfo),
  }
}

type PanesListRawResponse = Omit<PanesListResponse, "data"> & { data?: RawPaneInfo[] }

export async function listPanes(
  targetName: string,
  sessionName: string,
  windowId: string,
): Promise<PanesListResponse> {
  const response = (await ipcInvoke<PanesListRawResponse>("list_panes", {
    target: targetName,
    session: sessionName,
    window: windowId,
  }))!
  return {
    ...response,
    data: (response.data ?? []).map(normalizePaneInfo),
  }
}

type NormalizedSession = {
  id: string
  name: string
  attached: boolean
  windowCount: number
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

type RawSessionItem = {
  ID?: string
  Name?: string
  Attached?: boolean
  WindowCount?: number
  id?: string
  name?: string
  attached?: boolean
  windowCount?: number
  AttentionState?: "none" | "attention" | "explicit"
  attentionState?: "none" | "attention" | "explicit"
  AttentionCount?: number
  attentionCount?: number
  IntelligenceApp?: string
  intelligenceApp?: string
  IntelligenceStatus?: string
  intelligenceStatus?: string
  IntelligenceSummary?: string
  intelligenceSummary?: string
  IntelligenceSource?: string
  intelligenceSource?: string
  IntelligenceConfidence?: number
  intelligenceConfidence?: number
  IntelligenceStale?: boolean
  intelligenceStale?: boolean
  IntelligenceUpdatedAt?: string
  intelligenceUpdatedAt?: string
  IntelligenceError?: string
  intelligenceError?: string
  IntelligenceAppCounts?: Record<string, number>
  intelligenceAppCounts?: Record<string, number>
}

type SessionsListRawResponse = {
  targetName: string
  mode: string
  adapterPath?: string
  data: RawSessionItem[]
}

export async function listSessions(targetName: string): Promise<SessionsListResponse> {
  const response = (await ipcInvoke<SessionsListRawResponse>("list_sessions", {
    target: targetName,
  }))!
  return {
    ...response,
    data: (response.data ?? [])
      .map((s): NormalizedSession => {
        if (typeof s === "string") {
          return { id: "", name: s, attached: false, windowCount: 0 }
        }
        return {
          id: s.id ?? s.ID ?? "",
          name: s.name ?? s.Name ?? "",
          attached: s.attached ?? s.Attached ?? false,
          windowCount: s.windowCount ?? s.WindowCount ?? 0,
          attentionState: s.attentionState ?? s.AttentionState,
          attentionCount: s.attentionCount ?? s.AttentionCount,
          intelligenceApp: s.intelligenceApp ?? s.IntelligenceApp,
          intelligenceStatus: s.intelligenceStatus ?? s.IntelligenceStatus,
          intelligenceSummary: s.intelligenceSummary ?? s.IntelligenceSummary,
          intelligenceSource: s.intelligenceSource ?? s.IntelligenceSource,
          intelligenceConfidence: s.intelligenceConfidence ?? s.IntelligenceConfidence,
          intelligenceStale: s.intelligenceStale ?? s.IntelligenceStale,
          intelligenceUpdatedAt: s.intelligenceUpdatedAt ?? s.IntelligenceUpdatedAt,
          intelligenceError: s.intelligenceError ?? s.IntelligenceError,
          intelligenceAppCounts: s.intelligenceAppCounts ?? s.IntelligenceAppCounts,
        }
      })
      .filter((s) => s.name.length > 0),
  }
}

export async function createSession(targetName: string, name: string): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("create_session", { target: targetName, name }))!
}

export async function killSession(targetName: string, session: string): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("delete_session", { target: targetName, session }))!
}

export async function renameSession(
  targetName: string,
  session: string,
  newName: string,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("rename_session", {
    target: targetName,
    session,
    newName,
  }))!
}

export async function createWindow(
  targetName: string,
  session: string,
  name?: string,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("create_window", {
    target: targetName,
    session,
    name,
  }))!
}

export async function killWindow(
  targetName: string,
  session: string,
  window: string,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("delete_window", {
    target: targetName,
    session,
    window,
  }))!
}

export async function splitPane(
  targetName: string,
  session: string,
  window: string,
  pane: string,
  horizontal: boolean,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("split_pane", {
    target: targetName,
    session,
    window,
    pane,
    horizontal,
  }))!
}

export async function killPane(
  targetName: string,
  session: string,
  window: string,
  pane: string,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("delete_pane", {
    target: targetName,
    session,
    window,
    pane,
  }))!
}

export async function renameWindow(
  targetName: string,
  session: string,
  windowId: string,
  newName: string,
): Promise<OperationResponse> {
  return (await ipcInvoke<OperationResponse>("rename_window", {
    target: targetName,
    session,
    window: windowId,
    name: newName,
  }))!
}

export async function sendKeysToPane(
  targetName: string,
  session: string,
  windowId: string,
  pane: string,
  keys: string[],
): Promise<void> {
  await ipcInvoke<void>("send_keys_to_pane", {
    target: targetName,
    session,
    window: windowId,
    pane,
    keys,
  })
}

export async function capturePane(
  targetName: string,
  session: string,
  windowId: string,
  pane: string,
  maxBytes?: number,
): Promise<{ output: string }> {
  return (await ipcInvoke<{ output: string }>("capture_pane", {
    target: targetName,
    session,
    window: windowId,
    pane,
    maxBytes,
  }))!
}

export async function clearPane(
  targetName: string,
  session: string,
  windowId: string,
  pane: string,
): Promise<void> {
  await ipcInvoke<void>("clear_pane", { target: targetName, session, window: windowId, pane })
}
export interface ConnectionHealth {
  targetName: string
  status: "online" | "offline"
  checkedAt: string
  errorCode?: string
  message?: string
}

export interface ConnectionHealthListResponse {
  data: ConnectionHealth[]
}

export async function listConnectionHealth(): Promise<ConnectionHealth[]> {
  return (await ipcInvoke<ConnectionHealth[]>("list_connections_health"))!
}

export async function getConnectionHealth(targetName: string): Promise<ConnectionHealth> {
  return (await ipcInvoke<ConnectionHealth>("connection_health", { id: targetName }))!
}

export async function getConfig(): Promise<AppConfig> {
  return normalizeAppConfig((await ipcInvoke<AppConfig>("get_config"))!)
}

export async function updateConfig(data: AppConfig): Promise<AppConfig> {
  return normalizeAppConfig(
    (await ipcInvoke<AppConfig>("update_config", { config: toConfigPayload(data) }))!,
  )
}

export interface SessionIntelligence {
  app: string
  status: string
  summary: string
  source: string
  confidence: number
  stale: boolean
  updatedAt: string
  error?: string
}

export interface AnalyzeSessionResponse {
  targetName: string
  session: string
  status: string
  updated: number
  skipped: number
  errors: number
  intelligence?: SessionIntelligence & { appCounts?: Record<string, number> }
}

export async function analyzeSession(
  targetName: string,
  session: string,
): Promise<AnalyzeSessionResponse> {
  return (await ipcInvoke<AnalyzeSessionResponse>("analyze_session", {
    target: targetName,
    session,
  }))!
}

export async function fetchErrorLogs(): Promise<ErrorLogsResponse> {
  return (await ipcInvoke<ErrorLogsResponse>("get_error_logs"))!
}

export async function clearErrorLogs(): Promise<void> {
  await ipcInvoke<void>("clear_error_logs")
}

// --- Projects client functions ---

export async function listProjects(): Promise<Project[]> {
  const response = (await ipcInvoke<{ data: Project[] }>("list_projects"))!
  return response.data ?? []
}

export async function createProject(data: NewProject): Promise<Project> {
  return (await ipcInvoke<Project>("create_project", { payload: data }))!
}

export async function getProject(id: string): Promise<Project> {
  return (await ipcInvoke<Project>("get_project", { id }))!
}

export async function updateProject(id: string, data: UpdateProject): Promise<Project> {
  return (await ipcInvoke<Project>("update_project", { id, payload: data }))!
}

export async function deleteProject(id: string, killSession = false): Promise<void> {
  await ipcInvoke<void>("delete_project", { id, killSession })
}

export async function launchProject(id: string): Promise<ProjectActionResponse> {
  return (await ipcInvoke<ProjectActionResponse>("launch_project", { id }))!
}

export async function syncProjectFromTmux(id: string): Promise<ProjectActionResponse> {
  return (await ipcInvoke<ProjectActionResponse>("sync_from_tmux", { id }))!
}

export async function generateProjectAiHtml(id: string): Promise<Project> {
  return (await ipcInvoke<Project>("generate_ai_html", { id }))!
}

// --- AI Stats client functions ---

export interface AiStatsQuery {
  limit?: number
  projectId?: string
  status?: string
}

export async function listAiStats(query: AiStatsQuery = {}): Promise<AiStatsResponse> {
  return (await ipcInvoke<AiStatsResponse>("get_ai_stats", {
    limit: query.limit,
    projectId: query.projectId,
    status: query.status,
  }))!
}

export async function cleanupAiStats(
  query: Pick<AiStatsQuery, "projectId"> = {},
): Promise<AiStatsCleanupResponse> {
  return (await ipcInvoke<AiStatsCleanupResponse>("cleanup_stale_window_events", {
    projectId: query.projectId,
  }))!
}

// --- Voice History client functions ---

export interface OmniHistoryQuery {
  conversationId: string
  limit?: number
  before?: string
}

export async function getOmniHistory(query: OmniHistoryQuery): Promise<OmniConversationMessage[]> {
  const response = (await ipcInvoke<{ data: OmniConversationMessage[] }>("list_voice_history", {
    conversationId: query.conversationId,
    limit: query.limit,
    before: query.before,
  }))!
  return response.data ?? []
}

export async function clearOmniHistory(): Promise<void> {
  await ipcInvoke<void>("clear_voice_history")
}

// --- AI Logs ---

export interface AiLogEntry {
  id: string
  conversationId: string
  eventKind: string
  model: string
  status: string
  promptText?: string | null
  toolName?: string | null
  toolCallId?: string | null
  toolArgumentsJson?: string | null
  toolResultJson?: string | null
  metricsJson?: string | null
  durationMs: number | null
  rawEventJson?: string | null
  errorMessage?: string | null
  createdAt: string
}

export interface AiLogListResponse {
  data: AiLogEntry[]
  nextCursor: string | null
}

export interface AiLogsQuery {
  limit?: number
  before?: string
}

export async function listAiLogs(query: AiLogsQuery = {}): Promise<AiLogListResponse> {
  return (await ipcInvoke<AiLogListResponse>("list_ai_logs", {
    limit: query.limit,
    before: query.before,
  }))!
}

export async function clearAiLogs(): Promise<void> {
  await ipcInvoke<void>("clear_ai_logs")
}
