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
  type SessionInfoData,
  type WindowInfo,
  type PaneInfo,
} from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState, type SelectedPane } from "../state/store.js";

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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        if (apiErr.code !== "connection_failed" && apiErr.code !== "unknown_error") {
          setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
        }
      }
    }
  }, [setSessions, setError]);

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

  const connectionSessions = useMemo(() => {
    if (!selectedConnectionId) return [] as SessionInfoData[];
    return sessions[selectedConnectionId] ?? [];
  }, [sessions, selectedConnectionId]);

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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
      } else {
        setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Failed to open session" });
      }
    }
  };

  /**
   * Lazy-load panes for a non-active window when a tab is first opened.
   * Exported for use by MainPanel when switching window tabs.
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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
          if (err instanceof Error && "code" in err) {
            const apiErr = err as { code: string; message: string };
            setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
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
                        className={`session-card${isActive ? " is-active" : ""}`}
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
                                <span className="session-card-name">{sname}</span>
                                {session.attached && (
                                  <span className="session-card-badge">active</span>
                                )}
                              </div>
                              <span className="session-card-hint">Click to open terminal</span>
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
