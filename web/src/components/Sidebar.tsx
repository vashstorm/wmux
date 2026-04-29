import { useEffect, useState } from "react";
import { listConnections, deleteConnection } from "../api/client.js";
import { getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

export function Sidebar() {
	const {
		connections,
		setConnections,
		selectedConnectionId,
		setSelectedConnectionId,
		setLoading,
		setError,
		setShowNewConnectionForm,
		setShowSettingsPanel,
		showConfirm,
	} = useAppState();
	const [searchQuery, setSearchQuery] = useState("");

	useEffect(() => {
		async function loadConnections() {
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
		}

		loadConnections();
	}, [setConnections, setError, setLoading]);

	const filteredConnections = connections.filter((c) =>
		c.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	const handleDeleteConnection = (connection: { id: string; name: string }) => {
		showConfirm({
			title: "Delete Connection",
			message: `Delete connection "${connection.name}"? This cannot be undone.`,
			confirmText: "Delete Connection",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await deleteConnection(connection.id);
					setConnections(connections.filter((c) => c.id !== connection.id));
					if (selectedConnectionId === connection.id) {
						setSelectedConnectionId(null);
					}
				} catch (err) {
					if (err instanceof Error && "code" in err) {
						const apiErr = err as { code: string; message: string };
						setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) });
					}
				}
			},
		});
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
					>
						Settings
					</button>
				</div>
			</div>

			<div className="sidebar-toolbar">
				<div className="sidebar-search-wrapper">
					<span className="sidebar-search-icon" aria-hidden="true">
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M7.33333 12.6667C10.2789 12.6667 12.6667 10.2789 12.6667 7.33333C12.6667 4.38781 10.2789 2 7.33333 2C4.38781 2 2 4.38781 2 7.33333C2 10.2789 4.38781 12.6667 7.33333 12.6667Z"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<path
								d="M14 14L11.1 11.1"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
					<input
						type="text"
						className="sidebar-search"
						placeholder="Search connections"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						data-testid="connection-search"
						aria-label="Search connections"
					/>
				</div>

				<button
					className="new-connection-button"
					data-testid="new-connection-button"
					type="button"
					onClick={() => setShowNewConnectionForm(true)}
				>
					<span aria-hidden="true">+</span>
					<span>New</span>
				</button>
			</div>

			<div className="sidebar-content">
				{filteredConnections.length === 0 ? (
					<div className="sidebar-empty">
						{searchQuery ? "No connections match your search" : "No connections yet"}
					</div>
				) : (
					<ul className="connection-list">
						{filteredConnections.map((connection) => (
							<li
								key={connection.id}
								className={`connection-item ${selectedConnectionId === connection.id ? "is-active" : ""}`}
								onClick={() => setSelectedConnectionId(connection.id)}
								data-testid={`connection-item-${connection.id}`}
							>
								<div className="connection-icon" aria-hidden="true">
									{connection.type === "ssh" ? (
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
											<path d="M5 12h14M12 5l7 7-7 7" />
										</svg>
									) : (
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
											<rect x="2" y="3" width="20" height="14" rx="2" />
											<path d="M8 21h8M12 17v4" />
										</svg>
									)}
								</div>
								<span className="connection-name">{connection.name}</span>
								<button
									type="button"
									className="connection-delete-btn"
									onClick={(e) => {
										e.stopPropagation();
										handleDeleteConnection(connection);
									}}
									title="Delete connection"
									aria-label="Delete connection"
									data-testid={`delete-connection-${connection.id}`}
								>
									×
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}
