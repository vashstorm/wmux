import { useEffect, useState, useCallback, useMemo } from "react";
import {
  listConnections,
  listConnectionHealth,
  listSessions,
  listWindows,
  listPanes,
  createSession,
  killSession,
  renameSession,
  killWindow,
  killPane,
} from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

interface SessionExpandState {
  expanded: boolean;
  windowsLoaded: boolean;
}

interface FlatSession {
  connectionId: string;
  connectionName: string;
  sessionName: string;
}

export function Sidebar() {
  const {
    connections,
    setConnections,
    setLoading,
    setError,
    setShowSettingsPanel,
    showConfirm,
    connectionHealth,
    setConnectionHealth,
    sessions,
    setSessions,
    windows,
    setWindows,
    selectedPane,
    setSelectedPane,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState("");
  const [sessionExpand, setSessionExpand] = useState<Record<string, SessionExpandState>>({});
  const [windowExpand, setWindowExpand] = useState<Record<string, boolean>>({});
  const [newSessionName, setNewSessionName] = useState("");
  const [showNewSessionForConnection, setShowNewSessionForConnection] = useState<string | null>(null);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  useEffect(() => {
    async function loadConnections() {
      setLoading("connections", true);
      try {
        const data = await listConnections();
        setConnections(data);
        for (const conn of data) {
          try {
            const response = await listSessions(conn.id);
            setSessions(conn.id, response.data ?? []);
          } catch (err) {
            if (err instanceof Error && "code" in err) {
              const apiErr = err as { code: string; message: string };
              setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
            }
          }
        }
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
    }
    loadConnections();
  }, [setConnections, setError, setLoading, loadHealth, setSessions]);

  const flatSessions = useMemo<FlatSession[]>(() => {
    const result: FlatSession[] = [];
    for (const conn of connections) {
      const connSessions = sessions[conn.id] ?? [];
      for (const sessionName of connSessions) {
        result.push({
          connectionId: conn.id,
          connectionName: conn.name,
          sessionName,
        });
      }
    }
    return result;
  }, [connections, sessions]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return flatSessions;
    const query = searchQuery.toLowerCase();
    return flatSessions.filter((s) => s.sessionName.toLowerCase().includes(query));
  }, [flatSessions, searchQuery]);

  const connectionsWithoutSessions = useMemo(() => {
    if (searchQuery.trim()) {
      return [];
    }

    return connections.filter((connection) => (sessions[connection.id] ?? []).length === 0);
  }, [connections, sessions, searchQuery]);

  const toggleSession = useCallback(async (connectionId: string, sessionName: string) => {
    setSessionExpand((prev) => {
      const key = `${connectionId}:${sessionName}`;
      const cur = prev[key];
      const willExpand = !cur?.expanded;
      if (willExpand && !cur?.windowsLoaded) {
        listWindows(connectionId, sessionName).then((response) => {
          const wins = (response.data ?? []).map((w: any) => ({
            id: w.id ?? w.ID ?? "",
            name: w.name ?? w.Name ?? "",
            panes: w.panes ?? [],
            index: w.index ?? w.Index ?? 0,
          }));
          setWindows(connectionId, sessionName, wins);
          for (const win of wins) {
            if (win.id) {
              listPanes(connectionId, sessionName, win.id).then((paneResponse) => {
                const paneData = (paneResponse.data ?? []).map((p: any) => ({
                  id: p.id ?? p.ID ?? "",
                  index: p.index ?? p.Index ?? 0,
                }));
                setWindows(connectionId, sessionName, wins.map((w: any) =>
                  w.id === win.id ? { ...w, panes: paneData } : w,
                ));
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      }
      return {
        ...prev,
        [key]: { expanded: willExpand, windowsLoaded: true },
      };
    });
  }, [setWindows]);

  const toggleWindow = useCallback((connectionId: string, sessionName: string, windowId: string) => {
    const key = `${connectionId}:${sessionName}:${windowId}`;
    setWindowExpand((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleCreateSession = async (e: React.FormEvent, connectionId: string) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    try {
      await createSession(connectionId, newSessionName.trim());
      setNewSessionName("");
      setShowNewSessionForConnection(null);
      const response = await listSessions(connectionId);
      setSessions(connectionId, response.data ?? []);
    } catch (err) {
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string };
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
      }
    }
  };

  const handleKillSession = (connectionId: string, session: string) => {
    showConfirm({
      title: "Kill Session",
      message: `Are you sure you want to kill session "${session}"?`,
      confirmText: "Kill Session",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killSession(connectionId, session);
          const response = await listSessions(connectionId);
          setSessions(connectionId, response.data ?? []);
        } catch (err) {
          if (err instanceof Error && "code" in err) {
            const apiErr = err as { code: string; message: string };
            setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
          }
        }
      },
    });
  };

  const handleRenameSession = (connectionId: string, sessionName: string) => {
    setRenamingSession(`${connectionId}:${sessionName}`);
    setRenameValue(sessionName);
  };

  const submitRename = async (connectionId: string, sessionName: string) => {
    const newName = renameValue.trim();
    if (!newName || newName === sessionName) {
      setRenamingSession(null);
      setRenameValue("");
      return;
    }
    try {
      await renameSession(connectionId, sessionName, newName);
      const response = await listSessions(connectionId);
      setSessions(connectionId, response.data ?? []);
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

  const handleKillWindow = (connectionId: string, sessionName: string, windowId: string) => {
    showConfirm({
      title: "Kill Window",
      message: `Kill window?`,
      confirmText: "Kill Window",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killWindow(connectionId, sessionName, windowId);
          const winResponse = await listWindows(connectionId, sessionName);
          const wins = (winResponse.data ?? []).map((w: any) => ({
            id: w.id ?? w.ID ?? "",
            name: w.name ?? w.Name ?? "",
            panes: w.panes ?? [],
            index: w.index ?? w.Index ?? 0,
          }));
          setWindows(connectionId, sessionName, wins);
        } catch (err) {
          if (err instanceof Error && "code" in err) {
            const apiErr = err as { code: string; message: string };
            setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
          }
        }
      },
    });
  };

  const handleKillPane = (connectionId: string, sessionName: string, windowId: string, paneId: string) => {
    showConfirm({
      title: "Kill Pane",
      message: `Kill pane?`,
      confirmText: "Kill Pane",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killPane(connectionId, sessionName, windowId, paneId);
          const paneResponse = await listPanes(connectionId, sessionName, windowId);
          const paneData = (paneResponse.data ?? []).map((p: any) => ({
            id: p.id ?? p.ID ?? "",
            index: p.index ?? p.Index ?? 0,
          }));
          setWindows(connectionId, sessionName, (windows[`${connectionId}:${sessionName}`] ?? []).map((w) =>
            w.id === windowId ? { ...w, panes: paneData } : w,
          ));
        } catch (err) {
          if (err instanceof Error && "code" in err) {
            const apiErr = err as { code: string; message: string };
            setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
          }
        }
      },
    });
  };

  const handlePaneSelect = (connectionId: string, session: string, windowId: string, paneId: string) => {
    setSelectedPane({ connectionId, session, window: windowId, pane: paneId });
  };

  const getConnectionColor = (connectionId: string) => {
    const colors = [
      "#58a6ff",
      "#3fb950",
      "#d29922",
      "#f85149",
      "#a371f7",
      "#39c5cf",
      "#ff7b72",
      "#79c0ff",
    ];
    let hash = 0;
    for (let i = 0; i < connectionId.length; i++) {
      hash = connectionId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
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
      </div>

      <div className="sidebar-content">
        {filteredSessions.length === 0 && connectionsWithoutSessions.length === 0 ? (
          <div className="sidebar-empty">
            {searchQuery ? "No sessions match your search" : "No sessions yet"}
          </div>
        ) : (
          <>
            {filteredSessions.length > 0 ? (
              <ul className="sidebar-session-tree">
                {filteredSessions.map((flatSession) => {
                  const { connectionId, connectionName, sessionName } = flatSession;
                  const sessionKey = `${connectionId}:${sessionName}`;
                  const sessState = sessionExpand[sessionKey];
                  const sessExpanded = sessState?.expanded ?? false;
                  const sessionWindows = windows[sessionKey] ?? [];
                  const connHealth = connectionHealth[connectionId];
                  const isOnline = connHealth?.status === "online";
                  const isRenaming = renamingSession === sessionKey;

                  return (
                    <li key={sessionKey} className="sidebar-session-item">
                      <div className="sidebar-session-row">
                        <button
                          type="button"
                          className="connection-tree-toggle"
                          onClick={() => toggleSession(connectionId, sessionName)}
                          aria-expanded={sessExpanded}
                          data-testid={`session-toggle-${sessionName}`}
                        >
                          {sessExpanded ? "▼" : "▶"}
                        </button>

                        <span
                          className="connection-badge"
                          style={{
                            color: getConnectionColor(connectionId),
                            borderColor: `${getConnectionColor(connectionId)}40`,
                          }}
                          title={connectionName}
                        >
                          <span
                            className="connection-badge-dot"
                            style={{
                              backgroundColor: isOnline ? "var(--color-success)" : connHealth?.status === "offline" ? "var(--color-error)" : "var(--color-text-disabled)",
                            }}
                          />
                          {connectionName}
                        </span>

                        {isRenaming ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => submitRename(connectionId, sessionName)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(connectionId, sessionName);
                              if (e.key === "Escape") { setRenamingSession(null); setRenameValue(""); }
                            }}
                            autoFocus
                            className="session-rename-input"
                            data-testid={`rename-session-input-${sessionName}`}
                          />
                        ) : (
                          <span className="sidebar-session-label" data-testid={`session-label-${sessionName}`}>
                            {sessionName}
                          </span>
                        )}

                        <div className="sidebar-session-actions">
                          <button
                            type="button"
                            className="session-action-btn"
                            onClick={() => handleRenameSession(connectionId, sessionName)}
                            title="Rename"
                            data-testid={`rename-session-${sessionName}`}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="session-action-btn session-action-danger"
                            onClick={() => handleKillSession(connectionId, sessionName)}
                            title="Kill session"
                            data-testid={`kill-session-${sessionName}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      {sessExpanded && (
                        <ul className="sidebar-window-tree">
                          {sessionWindows.map((win) => {
                            const winKey = `${sessionKey}:${win.id}`;
                            const winExpanded = windowExpand[winKey] ?? false;

                            return (
                              <li key={win.id} className="sidebar-window-item">
                                <div className="sidebar-window-row">
                                  <button
                                    type="button"
                                    className="window-toggle"
                                    onClick={() => toggleWindow(connectionId, sessionName, win.id)}
                                    aria-expanded={winExpanded}
                                    data-testid={`window-toggle-${win.id}`}
                                  >
                                    {winExpanded ? "▼" : "▶"}
                                  </button>
                                  <span className="sidebar-window-label" data-testid={`window-label-${win.id}`}>{win.name}</span>
                                  <button
                                    type="button"
                                    className="session-action-btn session-action-danger"
                                    onClick={() => handleKillWindow(connectionId, sessionName, win.id)}
                                    title="Kill window"
                                    data-testid={`kill-window-${win.id}`}
                                  >
                                    ×
                                  </button>
                                </div>

                                {winExpanded && (
                                  <ul className="sidebar-pane-tree">
                                    {win.panes.map((pane) => {
                                      const isSelected =
                                        selectedPane?.connectionId === connectionId &&
                                        selectedPane?.session === sessionName &&
                                        selectedPane?.window === win.id &&
                                        selectedPane?.pane === pane.id;
                                      return (
                                        <li key={pane.id} className="sidebar-pane-item">
                                          <button
                                            type="button"
                                            className={`sidebar-pane-row${isSelected ? " is-selected" : ""}`}
                                            onClick={() => handlePaneSelect(connectionId, sessionName, win.id, pane.id)}
                                            data-testid={`pane-${pane.id}`}
                                          >
                                            <span className="sidebar-pane-label">Pane {pane.index}</span>
                                            <button
                                              type="button"
                                              className="session-action-btn session-action-danger"
                                              onClick={(e) => { e.stopPropagation(); handleKillPane(connectionId, sessionName, win.id, pane.id); }}
                                              title="Kill pane"
                                              data-testid={`kill-pane-${pane.id}`}
                                            >
                                              ×
                                            </button>
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}

                          {showNewSessionForConnection === connectionId ? (
                            <li className="sidebar-add-item">
                              <form className="sidebar-session-form" onSubmit={(e) => handleCreateSession(e, connectionId)}>
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
                                      setShowNewSessionForConnection(null);
                                      setNewSessionName("");
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button type="submit" className="form-button form-button-primary">Create</button>
                                </div>
                              </form>
                            </li>
                          ) : (
                            <li className="sidebar-add-item">
                              <button
                                type="button"
                                className="sidebar-add-btn"
                                onClick={() => setShowNewSessionForConnection(connectionId)}
                                data-testid={`new-session-button-${connectionId}`}
                              >
                                + New Session
                              </button>
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {connectionsWithoutSessions.length > 0 ? (
              <div className="sidebar-empty-connections" data-testid="empty-connections">
                {connectionsWithoutSessions.map((connection) => {
                  const connHealth = connectionHealth[connection.id];
                  const isOnline = connHealth?.status === "online";

                  return (
                    <div
                      key={connection.id}
                      className="sidebar-session-item"
                      data-testid={`empty-connection-${connection.id}`}
                    >
                      <div className="sidebar-session-row">
                        <span
                          className="connection-badge"
                          style={{
                            color: getConnectionColor(connection.id),
                            borderColor: `${getConnectionColor(connection.id)}40`,
                          }}
                          title={connection.name}
                        >
                          <span
                            className="connection-badge-dot"
                            style={{
                              backgroundColor: isOnline ? "var(--color-success)" : connHealth?.status === "offline" ? "var(--color-error)" : "var(--color-text-disabled)",
                            }}
                          />
                          {connection.name}
                        </span>
                        <span className="sidebar-session-label">No sessions yet</span>
                      </div>

                      {showNewSessionForConnection === connection.id ? (
                        <div className="sidebar-add-item">
                          <form className="sidebar-session-form" onSubmit={(e) => handleCreateSession(e, connection.id)}>
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
                                  setShowNewSessionForConnection(null);
                                  setNewSessionName("");
                                }}
                              >
                                Cancel
                              </button>
                              <button type="submit" className="form-button form-button-primary">Create</button>
                            </div>
                          </form>
                        </div>
                      ) : (
                        <div className="sidebar-add-item">
                          <button
                            type="button"
                            className="sidebar-add-btn"
                            onClick={() => setShowNewSessionForConnection(connection.id)}
                            data-testid={`new-session-button-${connection.id}`}
                          >
                            + New Session
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
