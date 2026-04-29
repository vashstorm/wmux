import { useState } from "react";
import { listSessions, createSession, killSession, renameSession, createWindow, killWindow, splitPane, killPane } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState, useSelectedConnection } from "../state/store.js";

interface SessionTreeNode {
	session: string;
	expanded: boolean;
	windows: { id: string; name: string; panes: { id: string; index: number }[]; expanded: boolean }[];
}

export function SessionList() {
	const connection = useSelectedConnection();
	const {
		sessions,
		setSessions,
		setError,
		showConfirm,
		loading,
		windows,
		setSelectedPane,
		selectedPane,
	} = useAppState();
	const [sessionTrees, setSessionTrees] = useState<Record<string, SessionTreeNode[]>>({});
	const [newSessionName, setNewSessionName] = useState("");
	const [showNewSession, setShowNewSession] = useState(false);
	const [renamingSession, setRenamingSession] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	if (!connection) {
		return (
			<div className="session-list-empty" data-testid="session-list">
				Select a connection to view sessions
			</div>
		);
	}

	const connectionSessions = sessions[connection.id] ?? [];

	const refreshSessions = async () => {
		try {
			const response = await listSessions(connection.id);
			setSessions(connection.id, response.data ?? []);
		} catch (err) {
			if (err instanceof Error && "code" in err) {
				const apiErr = err as { code: string; message: string };
				setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
			}
		}
	};

	const handleCreateSession = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newSessionName.trim()) return;
		try {
			await createSession(connection.id, newSessionName.trim());
			setNewSessionName("");
			setShowNewSession(false);
			await refreshSessions();
		} catch (err) {
			if (err instanceof Error && "code" in err) {
				const apiErr = err as { code: string; message: string };
				setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
			}
		}
	};

	const handleKillSession = (session: string) => {
		showConfirm({
			title: "Kill Session",
			message: `Are you sure you want to kill session "${session}"? This will terminate all windows and panes in this session.`,
			confirmText: "Kill Session",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await killSession(connection.id, session);
					await refreshSessions();
				} catch (err) {
					if (err instanceof Error && "code" in err) {
						const apiErr = err as { code: string; message: string };
						setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
					}
				}
			},
		});
	};

	const toggleSessionExpanded = (session: string) => {
		setSessionTrees((prev) => {
			const trees = prev[connection.id] ?? [];
			const existing = trees.find((t) => t.session === session);
			if (existing) {
				return {
					...prev,
					[connection.id]: trees.map((t) =>
						t.session === session ? { ...t, expanded: !t.expanded } : t,
					),
				};
			}
			return {
				...prev,
				[connection.id]: [...trees, { session, expanded: true, windows: [] }],
			};
		});
	};

	const handleRenameSession = (session: string) => {
		setRenamingSession(session);
		setRenameValue(session);
	};

	const submitRename = async (session: string) => {
		const newName = renameValue.trim();
		if (!newName || newName === session) {
			setRenamingSession(null);
			setRenameValue("");
			return;
		}
		try {
			await renameSession(connection.id, session, newName);
			await refreshSessions();
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

	const trees = sessionTrees[connection.id] ?? [];

	return (
		<div className="session-list" data-testid="session-list">
			<div className="session-list-header">
				<h2 className="session-list-title">Sessions</h2>
				<button
					type="button"
					className="session-list-new-btn"
					onClick={() => setShowNewSession(!showNewSession)}
					data-testid="new-session-button"
				>
					+
				</button>
			</div>

			{showNewSession && (
				<form className="new-session-form" onSubmit={handleCreateSession}>
					<input
						type="text"
						value={newSessionName}
						onChange={(e) => setNewSessionName(e.target.value)}
						placeholder="Session name"
						autoFocus
						data-testid="new-session-name-input"
					/>
					<div className="new-session-actions">
						<button
							type="button"
							className="form-button form-button-secondary"
							onClick={() => {
								setShowNewSession(false);
								setNewSessionName("");
							}}
						>
							Cancel
						</button>
						<button type="submit" className="form-button form-button-primary">
							Create
						</button>
					</div>
				</form>
			)}

			{loading.sessions ? (
				<div className="session-list-loading">Loading sessions...</div>
			) : connectionSessions.length === 0 ? (
				<div className="session-list-empty">No sessions yet</div>
			) : (
				<ul className="session-tree">
					{connectionSessions.map((session) => {
						const sessionName = typeof session === "string" ? session : session.name;
						if (!sessionName) return null;
						const tree = trees.find((t) => t.session === sessionName);
						const expanded = tree?.expanded ?? false;

						return (
							<li key={sessionName} className="session-tree-item">
								<div className="session-tree-row">
									<button
										type="button"
										className="session-tree-toggle"
										onClick={() => toggleSessionExpanded(sessionName)}
										aria-expanded={expanded}
									>
										{expanded ? "▼" : "▶"}
									</button>
									{renamingSession === sessionName ? (
										<input
											type="text"
											value={renameValue}
											onChange={(e) => setRenameValue(e.target.value)}
											onBlur={() => submitRename(sessionName)}
											onKeyDown={(e) => {
												if (e.key === "Enter") submitRename(sessionName);
												if (e.key === "Escape") {
													setRenamingSession(null);
													setRenameValue("");
												}
											}}
											autoFocus
											className="session-rename-input"
										/>
									) : (
										<span className="session-tree-label">{sessionName}</span>
									)}
									<div className="session-tree-actions">
										<button
											type="button"
											className="session-action-btn"
											onClick={() => handleRenameSession(sessionName)}
											title="Rename"
											aria-label="Rename session"
										>
											✎
										</button>
										<button
											type="button"
											className="session-action-btn session-action-danger"
											onClick={() => handleKillSession(sessionName)}
											title="Kill session"
											aria-label="Kill session"
										>
											×
										</button>
									</div>
								</div>

								{expanded && (
									<ul className="window-tree">
										{(windows[`${connection.id}:${sessionName}`] ?? []).map((win) => (
											<li key={win.id} className="window-tree-item">
												<div className="window-tree-row">
													<span className="window-tree-label">{win.name}</span>
													<button
														type="button"
														className="session-action-btn session-action-danger"
														onClick={() =>
															showConfirm({
																title: "Kill Window",
																message: `Kill window "${win.name}"?`,
																confirmText: "Kill Window",
																confirmVariant: "danger",
																onConfirm: async () => {
																	try {
																		await killWindow(connection.id, sessionName, win.id);
																		await refreshSessions();
																	} catch (err) {
																		if (err instanceof Error && "code" in err) {
																			const apiErr = err as { code: string; message: string };
																			setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
																		}
																	}
																},
															})
														}
														title="Kill window"
														aria-label="Kill window"
													>
														×
													</button>
												</div>
												<ul className="pane-tree">
													{win.panes.map((pane) => {
														const isSelected =
															selectedPane?.connectionId === connection.id &&
															selectedPane?.session === sessionName &&
															selectedPane?.window === win.id &&
															selectedPane?.pane === pane.id;
														return (
															<li key={pane.id} className="pane-tree-item">
																<button
																	type="button"
																	className={`pane-tree-row${isSelected ? " is-selected" : ""}`}
																	onClick={() =>
																		setSelectedPane({
																			connectionId: connection.id,
																			session: sessionName,
																			window: win.id,
																			pane: pane.id,
																		})
																	}
																>
																	<span className="pane-tree-label">Pane {pane.index}</span>
																	<button
																		type="button"
																		className="session-action-btn session-action-danger"
																	onClick={(e) => {
																		e.stopPropagation();
																		showConfirm({
																			title: "Kill Pane",
																			message: `Kill pane ${pane.index}?`,
																			confirmText: "Kill Pane",
																			confirmVariant: "danger",
																			onConfirm: async () => {
																				try {
																					killPane(connection.id, sessionName, win.id, pane.id);
																					await refreshSessions();
																				} catch (err) {
																					if (err instanceof Error && "code" in err) {
																						const apiErr = err as { code: string; message: string };
																						setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
																					}
																				}
																			},
																		})
																	}}
																	title="Kill pane"
																	aria-label="Kill pane"
																>
																	×
																</button>
															</button>
														</li>
														);
													})}
												</ul>
											</li>
										))}
									</ul>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
