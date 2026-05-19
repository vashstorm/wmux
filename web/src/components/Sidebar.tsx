import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Box,
  Stack,
  Paper,
  List,
  ListItemButton,
  TextField,
  Chip,
  Badge,
  IconButton,
  Typography,
  InputAdornment,
  Divider,
  Button,
  ListItemText,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import FolderIcon from "@mui/icons-material/Folder";
import TerminalIcon from "@mui/icons-material/Terminal";
import BarChartIcon from "@mui/icons-material/BarChart";
import SettingsIcon from "@mui/icons-material/Settings";
import DescriptionIcon from "@mui/icons-material/Description";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
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
  type SessionInfoData,
  type WindowInfo,
  type PaneInfo,
} from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState, type SelectedPane } from "../state/store.js";
import { formatRelativeTime } from "../ui/time.js";

const SESSION_SYNC_INTERVAL_MS = 2000;

const INTELLIGENCE_STATUS_LABELS: Record<string, string> = {
	waiting: "Waiting",
	dead_loop: "Loop",
	blocked: "Blocked",
	waiting_confirm: "Confirm",
	waiting_idle: "Idle",
	running: "Running",
};

const APP_BADGE_ORDER = ["claude", "codex", "opencode", "zsh"] as const;
type SidebarView = "projects" | "session" | "stats";

function isApiError(err: unknown): err is Error & { code: string; message: string } {
  return err instanceof Error && "code" in err && "message" in err;
}

export function Sidebar() {
  const {
    connections,
    setConnections,
    selectedConnectionId,
    setSelectedConnectionId,
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
    setWindows,
    setPanes,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("session");
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const prevSelectedRef = useRef<string | null>(null);

  const refreshErrorLogBadge = useCallback(async () => {
    try {
      const response = await fetchErrorLogs();
      setErrorLogCount(response.enabled ? response.lines.length : 0);
    } catch {
      setErrorLogCount(0);
    }
  }, [setErrorLogCount]);

  // Auto-select first connection on mount / when selected connection is removed
  useEffect(() => {
    if (connections.length === 0) {
      setSelectedConnectionId(null);
      return;
    }
    if (selectedConnectionId && connections.some((c) => c.id === selectedConnectionId)) {
      return;
    }
    setSelectedConnectionId(connections[0]?.id ?? null);
  }, [connections, selectedConnectionId, setSelectedConnectionId]);

  const loadHealth = useCallback(async () => {
    try {
      const healthData = await listConnectionHealth();
      const healthMap: Record<string, { connectionId: string; status: "online" | "offline"; checkedAt: string; errorCode?: string; message?: string }> = {};
      for (const h of healthData) {
        healthMap[h.connectionId] = h;
      }
      setConnectionHealth(healthMap);
    } catch {
      /* noop */
    }
  }, [setConnectionHealth]);

  const loadConnectionsList = useCallback(async () => {
    setLoading("connections", true);
    try {
      const data = await listConnections();
      setConnections(data);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      } else {
        setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Unknown error" });
      }
    } finally {
      setLoading("connections", false);
    }
    loadHealth();
  }, [setConnections, setError, setLoading, loadHealth]);

  const loadSessionsForConnection = useCallback(async (connectionId: string) => {
    try {
      const response = await listSessions(connectionId);
      setSessions(connectionId, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code !== "connection_failed" && err.code !== "unknown_error") {
          setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
        }
      }
    }
  }, [setSessions, setError]);

  // Initial load of connections list
  useEffect(() => {
    loadConnectionsList();
  }, [loadConnectionsList]);

  useEffect(() => {
    void refreshErrorLogBadge();
    const intervalId = window.setInterval(() => {
      void refreshErrorLogBadge();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshErrorLogBadge]);

  // Load sessions when selected connection changes
  useEffect(() => {
    if (!selectedConnectionId) return;
    const prevId = prevSelectedRef.current;
    prevSelectedRef.current = selectedConnectionId;

    if (prevId && prevId !== selectedConnectionId) {
      setShowNewSessionForm(false);
      setSearchQuery("");
      setSelectedPane(null);
    }

    loadSessionsForConnection(selectedConnectionId);
  }, [selectedConnectionId, loadSessionsForConnection]);

  useEffect(() => {
    if (!selectedConnectionId) return;

    let cancelled = false;
    let inFlight = false;
    const syncSessions = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await loadSessionsForConnection(selectedConnectionId);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void syncSessions();
    }, SESSION_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedConnectionId, loadSessionsForConnection]);

  const connectionSessions = useMemo(() => {
    if (!selectedConnectionId) return [];
    return sessions[selectedConnectionId] ?? [];
  }, [sessions, selectedConnectionId]);

  useEffect(() => {
    if (!selectedConnectionId || selectedPane?.connectionId !== selectedConnectionId) return;
    if (!sessions[selectedConnectionId]) return;
    if (connectionSessions.some((session) => session.name === selectedPane.session)) return;

    setSelectedPane(null);
  }, [connectionSessions, selectedConnectionId, selectedPane, sessions, setSelectedPane]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return connectionSessions;
    const query = searchQuery.toLowerCase();
    return connectionSessions.filter((s) => s.name?.toLowerCase().includes(query) ?? false);
  }, [connectionSessions, searchQuery]);

  const handleOpenSession = async (sessionName: string) => {
    if (!selectedConnectionId) return;
    const connId = selectedConnectionId;

    try {
      const windowsResponse = await listWindows(connId, sessionName);
      const windows = windowsResponse.data ?? [];

      if (windows.length === 0) {
        setSelectedPane({ connectionId: connId, session: sessionName });
        return;
      }

      const initialWindow = windows[0];
      if (!initialWindow) {
        setSelectedPane({ connectionId: connId, session: sessionName });
        return;
      }
      const initialWindowID = initialWindow.ID;

      const panesResponse = await listPanes(connId, sessionName, initialWindowID);
      const panes = panesResponse.data ?? [];

      setWindows(connId, sessionName, windows);
      setPanes(connId, sessionName, initialWindowID, panes);

      const initialPane = panes[0];

      setSelectedPane({
        connectionId: connId,
        session: sessionName,
        window: initialWindowID,
        pane: initialPane?.ID,
      });
    } catch (err) {
      setSelectedPane(null);
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      } else {
        setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Failed to open session" });
      }
    }
  };

  /**
   * Lazy-load panes for a non-active window when a tab is first opened.
   * Used internally; MainPanel imports listPanes directly from client.ts.
   */
  const loadWindowPanes = async (
    connectionId: string,
    sessionName: string,
    windowId: string,
  ): Promise<PaneInfo[] | null> => {
    try {
      const panesResponse = await listPanes(connectionId, sessionName, windowId);
      const panes = panesResponse.data ?? [];
      setPanes(connectionId, sessionName, windowId, panes);
      return panes;
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
      return null;
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConnectionId || !newSessionName.trim()) return;
    const connId = selectedConnectionId;
    try {
      await createSession(connId, newSessionName.trim());
      setNewSessionName("");
      setShowNewSessionForm(false);
      const response = await listSessions(connId);
      setSessions(connId, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    }
  };

  const reloadSessions = useCallback(async () => {
    if (!selectedConnectionId) return;
    const connId = selectedConnectionId;
    try {
      const response = await listSessions(connId);
      setSessions(connId, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    }
  }, [selectedConnectionId, setSessions, setError]);

  const handleKillSession = (sessionName: string) => {
    if (!selectedConnectionId) return;
    const connId = selectedConnectionId;
    showConfirm({
      title: "Kill Session",
      message: `Are you sure you want to kill session "${sessionName}"?`,
      confirmText: "Kill",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killSession(connId, sessionName);
          await reloadSessions();
        } catch (err) {
          if (isApiError(err)) {
            setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
          }
        }
      },
    });
  };

  const handleRenameSession = (sessionName: string) => {
    setRenamingSession(sessionName);
    setRenameValue(sessionName);
  };

  const submitRename = async (sessionName: string) => {
    if (!selectedConnectionId) return;
    const connId = selectedConnectionId;
    const newName = renameValue.trim();
    if (!newName || newName === sessionName) {
      setRenamingSession(null);
      setRenameValue("");
      return;
    }
    try {
      await renameSession(connId, sessionName, newName);
      await reloadSessions();
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    } finally {
      setRenamingSession(null);
      setRenameValue("");
    }
  };

  const openSessionView = () => {
    setActiveView("session");
  };

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
        borderRight: "1px solid var(--color-panel-border)",
        overflow: "hidden",
        bgcolor: "var(--color-panel)",
      }}
    >
      <Box
        className="sidebar-header"
        sx={{
          minHeight: "var(--app-shell-header-height, 42px)",
          display: "flex",
          alignItems: "center",
          px: "var(--spacing-lg)",
          borderBottom: "1px solid var(--color-surface-border)",
          background: "linear-gradient(to bottom, var(--color-glass-highlight), transparent)",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <Typography
            className="sidebar-brand"
            variant="subtitle1"
            sx={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--font-size-md)",
              fontWeight: "var(--font-weight-bold)",
              color: "var(--color-accent)",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              textShadow: "var(--color-accent-glow)",
            }}
          >
            Wmux
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <IconButton
              className={`sidebar-header-action${activeView === "projects" ? " is-active" : ""}`}
              onClick={() => setActiveView("projects")}
              data-testid="open-projects-button"
              aria-label="Projects"
              title="Projects"
              size="small"
              sx={{ width: 30, height: 30 }}
            >
              <FolderIcon fontSize="small" />
            </IconButton>
            <IconButton
              className={`sidebar-header-action${activeView === "session" ? " is-active" : ""}`}
              onClick={openSessionView}
              data-testid="open-session-button"
              aria-label="Session"
              title="Session"
              size="small"
              sx={{ width: 30, height: 30 }}
            >
              <TerminalIcon fontSize="small" />
            </IconButton>
            <IconButton
              className={`sidebar-header-action${activeView === "stats" ? " is-active" : ""}`}
              onClick={() => setActiveView("stats")}
              data-testid="open-stats-button"
              aria-label="Stats"
              title="Stats"
              size="small"
              sx={{ width: 30, height: 30 }}
            >
              <BarChartIcon fontSize="small" />
            </IconButton>
            <IconButton
              className="sidebar-header-action"
              onClick={() => setShowSettingsPanel(true)}
              data-testid="open-settings-button"
              aria-label="Setting"
              title="Setting"
              size="small"
              sx={{ width: 30, height: 30 }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
            <Badge
              badgeContent={errorLogCount > 0 ? (errorLogCount > 99 ? "99+" : errorLogCount) : undefined}
              color="error"
              className="error-logs-badge-wrapper"
              data-testid="error-logs-badge"
              sx={{
                "& .MuiBadge-badge": {
                  bgcolor: "var(--color-danger)",
                  color: "var(--color-background)",
                  border: "1px solid var(--color-panel)",
                  fontSize: "9px",
                  fontWeight: "var(--font-weight-bold)",
                  minWidth: 16,
                  height: 16,
                },
              }}
            >
              <IconButton
                className={`sidebar-header-action sidebar-error-logs-button${errorLogCount > 0 ? " has-badge" : ""}`}
                onClick={() => setShowErrorLogsPanel(true)}
                data-testid="open-error-logs-button"
                aria-label={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"}
                title={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"}
                size="small"
                sx={{ width: 30, height: 30 }}
              >
                <DescriptionIcon fontSize="small" />
              </IconButton>
            </Badge>
          </Stack>
        </Stack>
      </Box>

      <Box
        className="sidebar-content"
        sx={{
          flex: 1,
          overflowY: "auto",
          px: "var(--spacing-md)",
          py: "var(--spacing-sm)",
          scrollbarGutter: "stable",
        }}
      >
        {activeView === "projects" ? (
          <Box className="sidebar-empty-view" data-testid="projects-view" sx={{ minHeight: 1 }} />
        ) : activeView === "stats" ? (
          <Box className="sidebar-empty-view" data-testid="stats-view" sx={{ minHeight: 1 }} />
        ) : selectedConnectionId ? (
          <>
            <Box
              className="sidebar-toolbar"
              sx={{
                py: "var(--spacing-sm)",
                px: "var(--spacing-md)",
                mx: "calc(-1 * var(--spacing-md))",
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid var(--color-surface-border)",
              }}
            >
              <TextField
                fullWidth
                size="small"
                placeholder="Search sessions"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="session-search"
                aria-label="Search sessions"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" sx={{ color: "var(--color-text-muted)" }} />
                      </InputAdornment>
                    ),
                    className: "sidebar-search",
                  },
                }}
                sx={{
                  "& .MuiInputBase-root": {
                    pl: 0.5,
                    bgcolor: "var(--color-input-bg)",
                    borderRadius: "var(--radius-sm)",
                    "& .MuiOutlinedInput-notchedOutline": {
                      borderColor: "var(--color-input-border)",
                    },
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                      borderColor: "var(--color-surface-border-hover)",
                    },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                      borderColor: "var(--color-input-border-focus)",
                      borderWidth: 2,
                    },
                    "& input": {
                      color: "var(--color-input-text)",
                      fontSize: "var(--font-size-xs)",
                      py: "8px",
                    },
                    "& input::placeholder": {
                      color: "var(--color-input-placeholder)",
                    },
                  },
                }}
              />
            </Box>

            {showNewSessionForm && (
              <Box
                component="form"
                className="sidebar-session-form"
                onSubmit={handleCreateSession}
                sx={{
                  p: "var(--spacing-md)",
                  bgcolor: "var(--color-surface)",
                  border: "1px solid var(--color-surface-border)",
                  borderRadius: "var(--radius-md)",
                  my: "var(--spacing-xs)",
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="Session name"
                  autoFocus
                  data-testid="new-session-name-input"
                  sx={{
                    mb: "var(--spacing-sm)",
                    "& .MuiInputBase-root": {
                      bgcolor: "var(--color-input-bg)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "var(--font-size-xs)",
                      color: "var(--color-input-text)",
                      "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "var(--color-input-border)",
                      },
                      "&:focus-within .MuiOutlinedInput-notchedOutline": {
                        borderColor: "var(--color-input-border-focus)",
                        boxShadow: "0 0 0 2px var(--color-accent-subtle)",
                      },
                      "& input::placeholder": {
                        color: "var(--color-input-placeholder)",
                      },
                    },
                  }}
                />
                <Stack direction="row" spacing={1} className="sidebar-session-form-actions" sx={{ justifyContent: "flex-end" }}>
                  <Button
                    type="button"
                    className="form-button form-button-secondary"
                    onClick={() => {
                      setShowNewSessionForm(false);
                      setNewSessionName("");
                    }}
                    size="small"
                    variant="outlined"
                    sx={{
                      px: 1,
                      fontSize: "var(--font-size-xs)",
                      borderColor: "var(--color-surface-border)",
                      color: "var(--color-text)",
                      "&:hover": {
                        bgcolor: "var(--color-surface-hover)",
                        borderColor: "var(--color-glass-highlight-border)",
                        color: "var(--color-accent)",
                      },
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="form-button form-button-primary"
                    size="small"
                    variant="contained"
                    sx={{
                      px: 1,
                      fontSize: "var(--font-size-xs)",
                      bgcolor: "var(--color-accent)",
                      "&:hover": {
                        bgcolor: "var(--color-accent-hover)",
                      },
                    }}
                  >
                    Create
                  </Button>
                </Stack>
              </Box>
            )}

            <Box className="sidebar-sessions-section" sx={{ px: "var(--spacing-sm)" }}>
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
                    color: "var(--color-text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
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
                        fontSize: "10px",
                        fontWeight: "var(--font-weight-semibold)",
                        color: "var(--color-text-disabled)",
                        bgcolor: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                        minHeight: 20,
                        height: 20,
                      }}
                    />
                  )}
                  <IconButton
                    className="sidebar-session-create-button"
                    onClick={() => setShowNewSessionForm(!showNewSessionForm)}
                    data-testid="new-session-button"
                    aria-label="New Session"
                    title="New Session"
                    size="small"
                    sx={{
                      width: 22,
                      height: 22,
                      bgcolor: "var(--color-surface)",
                      border: "1px solid var(--color-surface-border)",
                      color: "var(--color-text-muted)",
                      "&:hover": {
                        bgcolor: "var(--color-surface-hover)",
                        color: "var(--color-accent)",
                        borderColor: "var(--color-glass-highlight-border)",
                        boxShadow: "var(--color-shadow-glow)",
                      },
                    }}
                  >
                    <AddIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Stack>
              </Stack>

              {filteredSessions.length === 0 ? (
                <Box
                  className="sidebar-empty-small"
                  sx={{
                    p: "var(--spacing-md) var(--spacing-sm)",
                    textAlign: "center",
                    color: "var(--color-text-muted)",
                    fontSize: "var(--font-size-xs)",
                    bgcolor: "var(--color-surface)",
                    borderRadius: "var(--radius-sm)",
                    mt: "var(--spacing-xs)",
                  }}
                >
                  {searchQuery ? "No sessions match your search" : "No sessions yet"}
                </Box>
              ) : (
                <List className="session-card-list" disablePadding sx={{ mt: "var(--spacing-sm)" }}>
                  {filteredSessions.map((session) => {
                    const sname = session.name ?? "";
                    if (!sname) return null;
                    const isRenaming = renamingSession === sname;

                    return (
                      <Box
                        key={sname}
                        className={`session-card${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}`}
                        data-testid={`session-card-${sname}`}
                        sx={{
                          mb: 0.75,
                        }}
                      >
                        {isRenaming ? (
                          <Box className="session-card-rename" sx={{ p: "var(--spacing-sm)" }}>
                            <TextField
                              fullWidth
                              size="small"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => submitRename(sname)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") submitRename(sname);
                                if (e.key === "Escape") { setRenamingSession(null); setRenameValue(""); }
                              }}
                              autoFocus
                              className="session-rename-input"
                              data-testid={`rename-session-input-${sname}`}
                              sx={{
                                "& .MuiInputBase-root": {
                                  bgcolor: "var(--color-panel)",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "var(--font-size-xs)",
                                  color: "var(--color-text)",
                                  border: "1px solid var(--color-accent)",
                                  "& fieldset": { border: "none" },
                                },
                              }}
                            />
                          </Box>
                        ) : (
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              position: "relative",
                            }}
                          >
                            <ListItemButton
                              className="session-card-body"
                              onClick={() => handleOpenSession(sname)}
                              data-testid={`session-open-${sname}`}
                              sx={{
                                flexDirection: "column",
                                alignItems: "stretch",
                                gap: "6px",
                                py: "12px",
                                px: "14px",
                                minWidth: 0,
                              }}
                            >
                              <Box className="session-card-name-group">
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    className="session-card-top"
                                    sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}
                                  >
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ alignItems: "center", minWidth: 0, flex: 1 }}
                                  >
                                    <Typography
                                      className="session-card-name"
                                      variant="body2"
                                      title={sname}
                                      sx={{
                                        fontSize: "var(--font-size-sm)",
                                        fontWeight: "var(--font-weight-bold)",
                                        color: "var(--color-text)",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        lineHeight: 1.2,
                                      }}
                                      noWrap
                                    >
                                      {sname}
                                    </Typography>
                                    {typeof session.windowCount === "number" && session.windowCount > 0 && (
                                      <Chip
                                        label={`${session.windowCount} w`}
                                        size="small"
                                        className="window-count-badge"
                                        sx={{
                                          fontSize: "10px",
                                          fontWeight: "var(--font-weight-semibold)",
                                          color: "var(--color-text-secondary)",
                                          bgcolor: "var(--color-surface)",
                                          border: "1px solid var(--color-surface-border)",
                                          minHeight: 18,
                                          height: 18,
                                          minWidth: 18,
                                        }}
                                      />
                                    )}
                                    {((session.intelligenceStatus && session.intelligenceStatus !== "none" && INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus]) || session.intelligenceError) && (
                                      <Chip
                                        label={session.intelligenceError ? "Error" : INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus ?? ""] ?? session.intelligenceStatus}
                                        size="small"
                                        className={`intelligence-badge${session.intelligenceError ? " is-error" : session.intelligenceStatus ? ` is-${session.intelligenceStatus}` : ""}`}
                                        sx={{
                                          fontSize: "10px",
                                          fontWeight: "var(--font-weight-semibold)",
                                          minHeight: 18,
                                          height: 18,
                                        }}
                                      />
                                    )}
                                  </Stack>
                                  {session.intelligenceUpdatedAt && (
                                    <Typography
                                      className="session-card-time"
                                      variant="caption"
                                      sx={{
                                        fontSize: "10px",
                                        color: "var(--color-text-muted)",
                                        flexShrink: 0,
                                        opacity: 0.6,
                                        fontWeight: 500,
                                      }}
                                    >
                                      {formatRelativeTime(session.intelligenceUpdatedAt)}
                                    </Typography>
                                  )}
                                </Stack>
                                {session.intelligenceSummary && (
                                  <Typography
                                    component="p"
                                    className="session-intelligence-summary"
                                    title={`${session.intelligenceSummary}${session.intelligenceError ? " [error]" : ""}${session.intelligenceStale ? " [stale]" : ""}${session.intelligenceSource ? ` via ${session.intelligenceSource}` : ""}`}
                                    sx={{
                                      fontSize: "11px",
                                      color: "var(--color-text-secondary)",
                                      m: "2px 0",
                                      display: "-webkit-box",
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      maxWidth: "100%",
                                      opacity: 0.9,
                                      fontFamily: "var(--font-stack)",
                                      lineHeight: 1.5,
                                      py: "4px",
                                    }}
                                  >
                                    {session.intelligenceSummary}
                                  </Typography>
                                )}
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  className="session-card-meta"
                                  sx={{
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    minHeight: "18px",
                                  }}
                                >
                                  {(session.attentionState === "attention" || session.attentionState === "explicit") && typeof session.attentionCount === "number" && session.attentionCount > 0 && (
                                    <Chip
                                      label={session.attentionCount}
                                      size="small"
                                      className={`attention-badge${session.attentionState === "attention" ? " is-soft" : ""}`}
                                      sx={{
                                        fontSize: "10px",
                                        minHeight: 18,
                                        height: 18,
                                      }}
                                    />
                                  )}
                                  {session.intelligenceAppCounts && APP_BADGE_ORDER.map((app) => {
                                    const count = session.intelligenceAppCounts![app];
                                    if (typeof count !== "number" || count <= 0) return null;
                                    return (
                                      <Chip
                                        key={app}
                                        label={`${app} ${count}`}
                                        size="small"
                                        className={`app-count-badge is-${app}`}
                                        sx={{
                                          fontSize: "10px",
                                          minHeight: 18,
                                          height: 18,
                                        }}
                                      />
                                    );
                                  })}
                                </Stack>
                              </Box>
                            </ListItemButton>
                            <Stack
                              direction="row"
                              spacing={0.5}
                              className="session-card-actions"
                              sx={{
                                alignItems: "center",
                                position: "absolute",
                                right: 0,
                                top: 0,
                                height: "100%",
                                px: "10px",
                                opacity: 0,
                                transition: "opacity var(--transition-fast)",
                                background: "linear-gradient(to left, var(--color-panel) 80%, transparent)",
                                ".session-card:hover &": {
                                  opacity: 1,
                                },
                                ".session-card.is-active &": {
                                  background: "linear-gradient(to left, var(--color-glass-highlight) 80%, transparent)",
                                },
                              }}
                            >
                              <IconButton
                                className="session-action-btn"
                                onClick={(e) => { e.stopPropagation(); handleRenameSession(sname); }}
                                title="Rename"
                                data-testid={`rename-session-${sname}`}
                                size="small"
                                sx={{
                                  width: 24,
                                  height: 24,
                                  color: "var(--color-text-muted)",
                                  "&:hover": {
                                    bgcolor: "var(--color-surface-hover)",
                                    color: "var(--color-text)",
                                  },
                                }}
                              >
                                <EditIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                              <IconButton
                                className="session-action-btn session-action-danger"
                                onClick={(e) => { e.stopPropagation(); handleKillSession(sname); }}
                                title="Kill session"
                                data-testid={`kill-session-${sname}`}
                                size="small"
                                sx={{
                                  width: 24,
                                  height: 24,
                                  color: "var(--color-text-muted)",
                                  "&:hover": {
                                    bgcolor: "var(--color-danger)",
                                    color: "var(--color-background)",
                                  },
                                }}
                              >
                                <DeleteIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Stack>
                          </Box>
                        )}
                      </Box>
                    );
                  })}
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
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              bgcolor: "var(--color-surface)",
              border: "1px dashed var(--color-surface-border)",
              borderRadius: "var(--radius-md)",
              mt: "var(--spacing-md)",
            }}
          >
            {connections.length === 0
              ? "No connections configured"
              : "Loading..."}
          </Box>
        )}
      </Box>
    </Paper>
  );
}
