import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  listConnections,
  listConnectionHealth,
  listSessions,
  listWindows,
  listPanes,
  createSession,
  killSession,
  renameSession,
  analyzeSession,
  type SessionInfoData,
  type WindowInfo,
  type PaneInfo,
} from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState, type SelectedPane } from "../state/store.js";

const SESSION_SYNC_INTERVAL_MS = 2000;

const INTELLIGENCE_STATUS_LABELS: Record<string, string> = {
	dead_loop: "Loop",
	blocked: "Blocked",
	waiting: "Waiting",
	running: "Running",
};

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
    showConfirm,
    setConnectionHealth,
    sessions,
    setSessions,
    updateSession,
    setSelectedPane,
    selectedPane,
    setWindows,
    setPanes,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const prevSelectedRef = useRef<string | null>(null);
  const analyzeDedupeRef = useRef<Map<string, number>>(new Map());
  const analyzeInFlightRef = useRef<Set<string>>(new Set());

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

      // Trigger async analyze for local sessions with stale/missing intelligence
      if (response.mode === "local") {
        const now = Date.now();
        const dedupeWindowMs = 60000; // 60 seconds

        for (const session of response.data ?? []) {
          const sessionName = session.name;
          if (!sessionName) continue;

          const dedupeKey = `${connectionId}:${sessionName}`;

          // Check if intelligence is missing or stale
          const hasIntelligence = session.intelligenceStatus !== undefined;
          const isStale = session.intelligenceStale === true;

          if (hasIntelligence && !isStale) continue;

          // Frontend-side dedupe: skip if triggered within last 60s
          const lastTriggered = analyzeDedupeRef.current.get(dedupeKey);
          if (lastTriggered !== undefined && now - lastTriggered < dedupeWindowMs) {
            continue;
          }

          // In-flight dedupe: skip if already in flight
          if (analyzeInFlightRef.current.has(dedupeKey)) {
            continue;
          }

          // Mark as triggered and in-flight
          analyzeDedupeRef.current.set(dedupeKey, now);
          analyzeInFlightRef.current.add(dedupeKey);

          // Fire-and-forget analyze
          analyzeSession(connectionId, sessionName)
            .then((result) => {
              if (result.intelligence) {
                updateSession(connectionId, sessionName, {
                  intelligenceApp: result.intelligence.app,
                  intelligenceStatus: result.intelligence.status,
                  intelligenceSummary: result.intelligence.summary,
                  intelligenceSource: result.intelligence.source,
                  intelligenceConfidence: result.intelligence.confidence,
                  intelligenceStale: result.intelligence.stale,
                  intelligenceUpdatedAt: result.intelligence.updatedAt,
                  intelligenceError: result.intelligence.error,
                });
              }
            })
            .catch(() => {
              // Silently skip on error
            })
            .finally(() => {
              analyzeInFlightRef.current.delete(dedupeKey);
            });
        }
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.code !== "connection_failed" && err.code !== "unknown_error") {
          setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
        }
      }
    }
  }, [setSessions, setError, updateSession]);

  // Initial load of connections list
  useEffect(() => {
    loadConnectionsList();
  }, [loadConnectionsList]);

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

      const activeWindow = windows.find((w) => w.Active) ?? windows[0];
      if (!activeWindow) {
        setSelectedPane({ connectionId: connId, session: sessionName });
        return;
      }
      const activeWindowID = activeWindow.ID;

      const panesResponse = await listPanes(connId, sessionName, activeWindowID);
      const panes = panesResponse.data ?? [];

      setWindows(connId, sessionName, windows);
      setPanes(connId, sessionName, activeWindowID, panes);

      const activePane = panes.find((p) => p.Active) ?? panes[0];

      setSelectedPane({
        connectionId: connId,
        session: sessionName,
        window: activeWindowID,
        pane: activePane?.ID,
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
      confirmText: "Kill Session",
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

  const isSessionActive = (sessionName: string) => {
    return selectedPane?.connectionId === selectedConnectionId && selectedPane?.session === sessionName;
  };

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div className="sidebar-brand">Wmux</div>
          <button
            type="button"
            className="sidebar-settings-button"
            onClick={() => setShowSettingsPanel(true)}
            data-testid="open-settings-button"
            aria-label="Settings"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {selectedConnectionId ? (
          <>
            <div className="sidebar-toolbar">
              <div className="sidebar-search-wrapper">
                <span className="sidebar-search-icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 14L11.1 11.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <input
                  type="text"
                  className="sidebar-search"
                  placeholder="Search sessions"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="session-search"
                  aria-label="Search sessions"
                />
              </div>
              <button
                type="button"
                className="new-connection-button"
                onClick={() => setShowNewSessionForm(!showNewSessionForm)}
                data-testid="new-session-button"
              >
                + New Session
              </button>
            </div>

            {showNewSessionForm && (
              <form className="sidebar-session-form" onSubmit={handleCreateSession}>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="Session name"
                  autoFocus
                  data-testid="new-session-name-input"
                />
                <div className="sidebar-session-form-actions">
                  <button
                    type="button"
                    className="form-button form-button-secondary"
                    onClick={() => {
                      setShowNewSessionForm(false);
                      setNewSessionName("");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="form-button form-button-primary">Create</button>
                </div>
              </form>
            )}

            <div className="sidebar-sessions-section">
              {filteredSessions.length === 0 ? (
                <div className="sidebar-empty-small">
                  {searchQuery ? "No sessions match your search" : "No sessions yet"}
                </div>
              ) : (
                <div className="session-card-list">
                  {filteredSessions.map((session) => {
                    const sname = session.name ?? "";
                    if (!sname) return null;
                    const isActive = isSessionActive(sname);
                    const isRenaming = renamingSession === sname;

                    return (
                      <div
                        key={sname}
                        className={`session-card${isActive ? " is-active" : ""}${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}`}
                        data-testid={`session-card-${sname}`}
                      >
                        {isRenaming ? (
                          <div className="session-card-rename">
                            <input
                              type="text"
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
                            />
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="session-card-body"
                              onClick={() => handleOpenSession(sname)}
                              data-testid={`session-open-${sname}`}
                            >
                              <div className="session-card-top">
                                <span className="session-card-name" title={sname}>{sname}</span>
                              </div>
                              <div className="session-card-meta">
                                {session.attached && (
                                  <span className="session-card-status-icon" title="active">
                                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                                      <circle cx="4" cy="4" r="4"/>
                                    </svg>
                                  </span>
                                )}
                                {typeof session.windowCount === "number" && session.windowCount > 0 && (
                                  <span className="session-card-meta-count">
                                    {session.windowCount} window{session.windowCount === 1 ? "" : "s"}
                                  </span>
                                )}
                                {(session.attentionState === "attention" || session.attentionState === "explicit") && typeof session.attentionCount === "number" && session.attentionCount > 0 && (
                                  <span className={`attention-badge${session.attentionState === "attention" ? " is-soft" : ""}`}>
                                    {session.attentionCount}
                                  </span>
                                )}
                                {((session.intelligenceStatus && session.intelligenceStatus !== "none" && INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus]) || session.intelligenceStale || session.intelligenceError) && (
                                  <span className={`intelligence-badge${session.intelligenceError ? " is-error" : session.intelligenceStale ? " is-stale" : session.intelligenceStatus ? ` is-${session.intelligenceStatus}` : ""}`}>
                                    {session.intelligenceError ? "Error" : session.intelligenceStale ? "Stale" : INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus ?? ""] ?? session.intelligenceStatus}
                                  </span>
                                )}
                              </div>
                              {session.intelligenceSummary && (
                                <p className="session-intelligence-summary" title={`${session.intelligenceSummary}${session.intelligenceStale ? " [stale]" : ""}${session.intelligenceError ? " [error]" : ""}${session.intelligenceSource ? ` via ${session.intelligenceSource}` : ""}`}>
                                  {session.intelligenceSummary}
                                </p>
                              )}
                            </button>
                            <div className="session-card-actions">
                              <button
                                type="button"
                                className="session-action-btn"
                                onClick={(e) => { e.stopPropagation(); handleRenameSession(sname); }}
                                title="Rename"
                                data-testid={`rename-session-${sname}`}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="session-action-btn session-action-danger"
                                onClick={(e) => { e.stopPropagation(); handleKillSession(sname); }}
                                title="Kill session"
                                data-testid={`kill-session-${sname}`}
                              >
                                ×
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="sidebar-empty">
            {connections.length === 0
              ? "No connections configured"
              : "Loading..."}
          </div>
        )}
      </div>
    </aside>
  );
}
