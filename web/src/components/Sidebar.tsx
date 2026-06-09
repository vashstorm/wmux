import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { Box, Stack, Paper, List, Chip, Typography, Collapse } from "@mui/material"
import AddIcon from "@mui/icons-material/Add"
import {
  listConnections,
  listConnectionHealth,
  listSessions,
  listWindows,
  listPanes,
  createSession,
  killSession,
  renameSession,
  fetchErrorLogs,
  listProjects,
  createProject,
  type Project,
} from "../api/client.js"
import { getErrorMessage } from "../api/errors.js"
import { useAppState } from "../state/store.js"
import { SidebarHeader } from "./sidebar/SidebarHeader.js"
import { SessionSearch } from "./sidebar/SessionSearch.js"
import { NewSessionForm } from "./sidebar/NewSessionForm.js"
import { SidebarFooter } from "./sidebar/SidebarFooter.js"
import { SessionCard } from "./sidebar/SessionCard.js"
import { SidebarIconButton } from "./sidebar/SidebarIconButton.js"
import { ProjectsView } from "./sidebar/ProjectsView.js"
import { StatsView } from "./sidebar/StatsView.js"
import { AiLogsView } from "./sidebar/AiLogsView.js"

const SESSION_SYNC_INTERVAL_MS = 2000

function isApiError(err: unknown): err is Error & { code: string; message: string } {
  return err instanceof Error && "code" in err && "message" in err
}

export function Sidebar({
  themeToggle,
  terminalThemeToggle,
}: {
  themeToggle?: React.ReactNode
  terminalThemeToggle?: React.ReactNode
}) {
  const {
    connections,
    setConnections,
    selectedTargetName,
    setSelectedTargetName,
    setLoading,
    setError,
    setShowSettingsPanel,
    setShowErrorLogsPanel,
    errorLogCount,
    setErrorLogCount,
    showConfirm,
    setConnectionHealth,
    sessions,
    setSessions,
    setSelectedPane,
    selectedPane,
    setSelectedAiEvent,
    setWindows,
    setPanes,
    selectedProject,
    setSelectedProject,
  } = useAppState()

  const [searchQuery, setSearchQuery] = useState("")
  const [newSessionName, setNewSessionName] = useState("")
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [activeView, setActiveView] = useState<"projects" | "session" | "stats" | "ai_logs">(
    "session",
  )
  const [projects, setProjects] = useState<Project[]>([])
  const prevSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    const handleVoiceNavigation = (event: Event) => {
      const route = (event as CustomEvent<{ route?: string }>).detail?.route
      if (route === "projects" || route === "session" || route === "stats" || route === "ai_logs") {
        setActiveView(route)
      }
    }

    window.addEventListener("wmux:navigate-sidebar", handleVoiceNavigation)
    return () => window.removeEventListener("wmux:navigate-sidebar", handleVoiceNavigation)
  }, [])

  const refreshErrorLogBadge = useCallback(async () => {
    try {
      const response = await fetchErrorLogs()
      setErrorLogCount(response.enabled ? response.lines.length : 0)
    } catch {
      setErrorLogCount(0)
    }
  }, [setErrorLogCount])

  useEffect(() => {
    if (connections.length === 0) {
      setSelectedTargetName(null)
      return
    }
    if (selectedTargetName && connections.some((c) => c.targetName === selectedTargetName)) {
      return
    }
    setSelectedTargetName(connections[0]?.targetName ?? null)
  }, [connections, selectedTargetName, setSelectedTargetName])

  const loadHealth = useCallback(async () => {
    try {
      const healthData = await listConnectionHealth()
      const healthMap: Record<
        string,
        {
          targetName: string
          status: "online" | "offline"
          checkedAt: string
          errorCode?: string
          message?: string
        }
      > = {}
      for (const h of healthData) {
        healthMap[h.targetName] = h
      }
      setConnectionHealth(healthMap)
    } catch {
      /* noop */
    }
  }, [setConnectionHealth])

  const loadConnectionsList = useCallback(async () => {
    setLoading("connections", true)
    try {
      const data = await listConnections()
      setConnections(data)
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      } else {
        setError({
          code: "unknown_error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    } finally {
      setLoading("connections", false)
    }
    loadHealth()
  }, [setConnections, setError, setLoading, loadHealth])

  const loadSessionsForTarget = useCallback(
    async (targetName: string) => {
      try {
        const [sessionsResponse, projectsResponse] = await Promise.all([
          listSessions(targetName),
          Promise.resolve(listProjects()).catch((err) => {
            console.error("Failed to load projects:", err)
            return [] as Project[]
          }),
        ])
        setSessions(targetName, sessionsResponse.data ?? [])
        setProjects(projectsResponse ?? [])
      } catch (err) {
        if (isApiError(err)) {
          setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
        } else {
          setError({
            code: "unknown_error",
            message: err instanceof Error ? err.message : "Unknown error",
          })
        }
      }
    },
    [setSessions, setError],
  )

  useEffect(() => {
    loadConnectionsList()
  }, [loadConnectionsList])

  useEffect(() => {
    if (document.visibilityState === "visible") {
      void refreshErrorLogBadge()
    }
    const intervalIdRef = { current: 0 }

    const startInterval = () => {
      if (intervalIdRef.current !== 0) {
        window.clearInterval(intervalIdRef.current)
      }
      const id = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void refreshErrorLogBadge()
        }
      }, 10000)
      intervalIdRef.current = id
    }

    const stopInterval = () => {
      if (intervalIdRef.current !== 0) {
        window.clearInterval(intervalIdRef.current)
        intervalIdRef.current = 0
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopInterval()
      } else if (document.visibilityState === "visible") {
        void refreshErrorLogBadge()
        startInterval()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    startInterval()

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      stopInterval()
    }
  }, [refreshErrorLogBadge])

  useEffect(() => {
    if (!selectedTargetName) return
    const prevId = prevSelectedRef.current
    prevSelectedRef.current = selectedTargetName

    if (prevId && prevId !== selectedTargetName) {
      setShowNewSessionForm(false)
      setSearchQuery("")
      setSelectedPane(null)
    }

    if (document.visibilityState === "visible") {
      loadSessionsForTarget(selectedTargetName)
    }
  }, [selectedTargetName, loadSessionsForTarget, setSelectedPane])

  useEffect(() => {
    if (!selectedTargetName) return

    let cancelled = false
    let inFlight = false
    const intervalIdRef = { current: 0 }

    const syncSessions = async () => {
      if (document.visibilityState === "hidden") return
      if (cancelled || inFlight) return
      inFlight = true
      try {
        await loadSessionsForTarget(selectedTargetName)
      } finally {
        inFlight = false
      }
    }

    const startInterval = () => {
      if (intervalIdRef.current !== 0) {
        window.clearInterval(intervalIdRef.current)
      }
      const id = window.setInterval(() => {
        void syncSessions()
      }, SESSION_SYNC_INTERVAL_MS)
      intervalIdRef.current = id
    }

    const stopInterval = () => {
      if (intervalIdRef.current !== 0) {
        window.clearInterval(intervalIdRef.current)
        intervalIdRef.current = 0
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopInterval()
      } else if (document.visibilityState === "visible") {
        void syncSessions()
        startInterval()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    void syncSessions()
    startInterval()

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      stopInterval()
    }
  }, [selectedTargetName, loadSessionsForTarget])

  const targetSessions = useMemo(() => {
    if (!selectedTargetName) return []
    return sessions[selectedTargetName] ?? []
  }, [sessions, selectedTargetName])

  useEffect(() => {
    if (!selectedTargetName || selectedPane?.targetName !== selectedTargetName) return
    if (!sessions[selectedTargetName]) return
    if (targetSessions.some((session) => session.name === selectedPane.session)) return

    setSelectedPane(null)
  }, [targetSessions, selectedTargetName, selectedPane, sessions, setSelectedPane])

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return targetSessions
    const query = searchQuery.toLowerCase()
    return targetSessions.filter((s) => s.name?.toLowerCase().includes(query) ?? false)
  }, [targetSessions, searchQuery])

  const handleOpenSession = async (sessionName: string) => {
    if (!selectedTargetName) return
    const targetName = selectedTargetName
    setSelectedAiEvent(null)

    try {
      const windowsResponse = await listWindows(targetName, sessionName)
      const windows = windowsResponse.data ?? []

      if (windows.length === 0) {
        setSelectedPane({ targetName: targetName, session: sessionName })
        return
      }

      const initialWindow = windows[0]
      if (!initialWindow) {
        setSelectedPane({ targetName: targetName, session: sessionName })
        return
      }
      const initialWindowID = initialWindow.ID

      const panesResponse = await listPanes(targetName, sessionName, initialWindowID)
      const panes = panesResponse.data ?? []

      setWindows(targetName, sessionName, windows)
      setPanes(targetName, sessionName, initialWindowID, panes)

      const initialPane = panes[0]

      setSelectedPane({
        targetName: targetName,
        session: sessionName,
        window: initialWindowID,
        pane: initialPane?.ID,
      })
    } catch (err) {
      setSelectedPane(null)
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      } else {
        setError({
          code: "unknown_error",
          message: err instanceof Error ? err.message : "Failed to open session",
        })
      }
    }
  }

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTargetName || !newSessionName.trim()) return
    const targetName = selectedTargetName
    try {
      await createSession(targetName, newSessionName.trim())
      setNewSessionName("")
      setShowNewSessionForm(false)
      const response = await listSessions(targetName)
      setSessions(targetName, response.data ?? [])
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      }
    }
  }

  const reloadSessions = useCallback(async () => {
    if (!selectedTargetName) return
    const targetName = selectedTargetName
    try {
      const [sessionsResponse, projectsResponse] = await Promise.all([
        Promise.resolve(listSessions(targetName)).catch(() => null),
        Promise.resolve(listProjects()).catch(() => [] as Project[]),
      ])
      setSessions(targetName, sessionsResponse?.data ?? [])
      setProjects(projectsResponse ?? [])
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      }
    }
  }, [selectedTargetName, setSessions, setError])

  const handleKillSession = (sessionName: string) => {
    if (!selectedTargetName) return
    const targetName = selectedTargetName
    showConfirm({
      title: "Kill Session",
      message: `Are you sure you want to kill session "${sessionName}"?`,
      confirmText: "Kill",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killSession(targetName, sessionName)
          await reloadSessions()
        } catch (err) {
          if (isApiError(err)) {
            setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
          }
        }
      },
    })
  }

  const handleRenameSession = (sessionName: string) => {
    // Rename is handled by SessionCard's internal state
  }

  const handleSubmitRename = async (sessionName: string, newName: string) => {
    if (!selectedTargetName) return
    const targetName = selectedTargetName
    try {
      await renameSession(targetName, sessionName, newName)
      await reloadSessions()
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      }
    }
  }

  const handleBuildProject = async (sessionName: string) => {
    try {
      const existingProjects = await listProjects()
      const matched = existingProjects.find(
        (p) => p.sessionName === sessionName || p.name === sessionName,
      )
      if (matched) {
        setSelectedProject(matched)
        setActiveView("projects")
      } else {
        showConfirm({
          title: "Associate Project (Step 1/2)",
          message: `Do you want to create a new project associated with session "${sessionName}"?`,
          confirmText: "Continue",
          confirmVariant: "primary",
          onConfirm: () => {
            showConfirm({
              title: "Confirm Association (Step 2/2)",
              message: `Please confirm that you want to proceed with creating and associating the project "${sessionName}".`,
              confirmText: "Create Project",
              confirmVariant: "primary",
              onConfirm: async () => {
                try {
                  const newProj = await createProject({
                    name: sessionName,
                    sessionName: sessionName,
                    path: "",
                    description: `Imported from active session ${sessionName}`,
                  })
                  const updatedProjects = await listProjects().catch(() => [] as Project[])
                  setProjects(updatedProjects)
                  setSelectedProject(newProj)
                  setActiveView("projects")
                } catch (err) {
                  if (isApiError(err)) {
                    setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
                  } else {
                    setError({
                      code: "unknown_error",
                      message: err instanceof Error ? err.message : "Failed to build project",
                    })
                  }
                }
              },
            })
          },
        })
      }
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) })
      } else {
        setError({
          code: "unknown_error",
          message: err instanceof Error ? err.message : "Failed to build project",
        })
      }
    }
  }

  return (
    <Paper
      component="aside"
      className="sidebar"
      data-testid="sidebar"
      elevation={0}
      square
      sx={{
        width: 320,
        minWidth: 320,
        maxWidth: 320,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        borderRight: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <SidebarHeader activeView={activeView} onViewChange={setActiveView} />

      <Box
        className="sidebar-content"
        sx={{
          flex: 1,
          overflowY: "auto",
          px: "var(--spacing-lg)",
          py: "var(--spacing-md)",
          scrollbarGutter: "stable",
        }}
      >
        {activeView === "projects" ? (
          <ProjectsView />
        ) : activeView === "stats" ? (
          <StatsView />
        ) : activeView === "ai_logs" ? (
          <AiLogsView />
        ) : selectedTargetName ? (
          <>
            <SessionSearch value={searchQuery} onChange={setSearchQuery} />

            <Collapse in={showNewSessionForm} timeout={250} unmountOnExit>
              <NewSessionForm
                value={newSessionName}
                onChange={setNewSessionName}
                onSubmit={handleCreateSession}
                onCancel={() => {
                  setShowNewSessionForm(false)
                  setNewSessionName("")
                }}
              />
            </Collapse>

            <Box className="sidebar-sessions-section" sx={{ px: 0 }}>
              <Stack
                direction="row"
                spacing={1}
                className="sidebar-sessions-header"
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  py: "var(--spacing-xs)",
                  px: "var(--spacing-sm)",
                  mb: 0.5,
                }}
              >
                <Typography
                  className="sidebar-section-label"
                  variant="caption"
                  sx={{
                    fontSize: "var(--font-size-xs)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "text.secondary",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Sessions
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {filteredSessions.length > 0 && (
                    <Chip
                      label={filteredSessions.length}
                      size="small"
                      className="sidebar-session-count"
                      sx={{
                        fontSize: "var(--font-size-xs)",
                        fontWeight: "var(--font-weight-semibold)",
                        color: "text.disabled",
                        bgcolor: "background.default",
                        border: "1px solid",
                        borderColor: "divider",
                        minHeight: 20,
                        height: 20,
                      }}
                    />
                  )}
                  <SidebarIconButton
                    className="sidebar-session-create-button"
                    icon={AddIcon}
                    variant="compact"
                    onClick={() => setShowNewSessionForm(!showNewSessionForm)}
                    data-testid="new-session-button"
                    aria-label="New Session"
                    aria-expanded={showNewSessionForm}
                    title="New Session"
                    sx={{
                      bgcolor: "background.default",
                      border: "1px solid",
                      borderColor: "divider",
                      color: "text.secondary",
                      "&:hover": {
                        bgcolor: "action.hover",
                        color: "primary.main",
                        borderColor: (theme) => `rgba(${theme.palette.primary.main}, 0.3)`,
                      },
                    }}
                  />
                </Stack>
              </Stack>

              {filteredSessions.length === 0 ? (
                <Box
                  className="sidebar-empty-small"
                  sx={{
                    p: "var(--spacing-md) var(--spacing-sm)",
                    textAlign: "center",
                    color: "text.secondary",
                    fontSize: "var(--font-size-xs)",
                    bgcolor: "background.default",
                    borderRadius: "var(--radius-sm)",
                    mt: "var(--spacing-xs)",
                  }}
                >
                  {searchQuery ? "No sessions match your search" : "No sessions yet"}
                </Box>
              ) : (
                <List className="session-card-list" disablePadding sx={{ mt: "var(--spacing-sm)" }}>
                  {filteredSessions.map((session) => (
                    <SessionCard
                      key={session.name ?? ""}
                      session={session}
                      isSelected={
                        selectedPane?.targetName === selectedTargetName &&
                        selectedPane?.session === session.name
                      }
                      onOpen={handleOpenSession}
                      onRename={handleRenameSession}
                      onKill={handleKillSession}
                      onSubmitRename={handleSubmitRename}
                      onBuildProject={handleBuildProject}
                      hasProject={projects.some(
                        (p) => p.sessionName === session.name || p.name === session.name,
                      )}
                    />
                  ))}
                </List>
              )}
            </Box>
          </>
        ) : (
          <Box
            className="sidebar-empty"
            sx={{
              p: "var(--spacing-xl) var(--spacing-md)",
              textAlign: "center",
              color: "text.secondary",
              fontSize: "var(--font-size-sm)",
              bgcolor: "background.default",
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: "var(--radius-md)",
              mt: "var(--spacing-md)",
            }}
          >
            {connections.length === 0 ? "No connections configured" : "Loading..."}
          </Box>
        )}
      </Box>

      <SidebarFooter
        errorLogCount={errorLogCount}
        onOpenSettings={() => setShowSettingsPanel(true)}
        onOpenErrorLogs={() => setShowErrorLogsPanel(true)}
        themeToggle={themeToggle}
        terminalThemeToggle={terminalThemeToggle}
      />
    </Paper>
  )
}
