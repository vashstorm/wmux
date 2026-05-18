import { useCallback, useEffect, useState } from "react";
import { clearErrorLogs, fetchErrorLogs } from "../api/client.js";
import { ApiError, getErrorMessage } from "../api/errors.js";
import { useAppState } from "../state/store.js";

export function ErrorLogsPanel() {
	const {
		showErrorLogsPanel,
		setShowErrorLogsPanel,
		setError,
		showConfirm,
		setErrorLogCount,
	} = useAppState();
	const [logEnabled, setLogEnabled] = useState(false);
	const [logPath, setLogPath] = useState<string | null>(null);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [logTruncated, setLogTruncated] = useState(false);
	const [maxLines, setMaxLines] = useState(1000);
	const [isLoadingLogs, setIsLoadingLogs] = useState(false);
	const [hasLoadedLogs, setHasLoadedLogs] = useState(false);

	const fetchLogs = useCallback(async () => {
		setIsLoadingLogs(true);
		try {
			const response = await fetchErrorLogs();
			setLogEnabled(response.enabled);
			setLogPath(response.path ?? null);
			setLogLines(response.lines);
			setLogTruncated(response.truncated);
			setMaxLines(response.maxLines);
			setErrorLogCount(response.enabled ? response.lines.length : 0);
		} catch (err) {
			if (err instanceof ApiError) {
				setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
			}
		} finally {
			setHasLoadedLogs(true);
			setIsLoadingLogs(false);
		}
	}, [setError, setErrorLogCount]);

	useEffect(() => {
		if (!showErrorLogsPanel) {
			return;
		}
		setHasLoadedLogs(false);
		void fetchLogs();
	}, [showErrorLogsPanel, fetchLogs]);

	if (!showErrorLogsPanel) {
		return null;
	}

	const closePanel = () => {
		setShowErrorLogsPanel(false);
	};

	const handleClearLogs = () => {
		showConfirm({
			title: "Clear Error Logs",
			message: "This will permanently delete all error log entries. This cannot be undone.",
			confirmText: "Clear",
			confirmVariant: "danger",
			onConfirm: async () => {
				try {
					await clearErrorLogs();
					setLogLines([]);
					setErrorLogCount(0);
					await fetchLogs();
				} catch (err) {
					if (err instanceof ApiError) {
						setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
					}
				}
			},
		});
	};

	return (
		<div className="error-logs-panel-overlay">
			<section
				className="error-logs-panel"
				data-testid="error-logs-panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="error-logs-title"
			>
				<div className="error-logs-panel-header">
					<div className="settings-panel-header-title">
						<h3 id="error-logs-title" className="form-title">Error Logs</h3>
						<span className="settings-panel-subtitle">Recent backend error entries</span>
					</div>
					<button type="button" className="error-banner-dismiss" onClick={closePanel} aria-label="Close error logs">
						×
					</button>
				</div>

				<div className="error-logs-panel-body">
					<div className="error-logs-toolbar">
						{logEnabled && logPath ? (
							<p className="form-help-text error-logs-path" data-testid="error-logs-path">
								Reading from <code>{logPath}</code>
							</p>
						) : (
							<span />
						)}
						<div className="error-logs-actions">
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => void fetchLogs()}
								disabled={isLoadingLogs}
								data-testid="error-logs-refresh"
							>
								{isLoadingLogs ? "Loading..." : "Refresh"}
							</button>
							<button
								type="button"
								className="btn btn-secondary error-logs-clear-button"
								onClick={handleClearLogs}
								disabled={logLines.length === 0 || isLoadingLogs}
								data-testid="error-logs-clear"
							>
								Clear
							</button>
						</div>
					</div>

					{isLoadingLogs || !hasLoadedLogs ? (
						<div className="settings-panel-loading">
							<div className="spinner" />
							<span>Loading error logs...</span>
						</div>
					) : !logEnabled ? (
						<div className="error-logs-empty-state" data-testid="error-logs-not-configured">
							<p>Error log file is not configured.</p>
						</div>
					) : logLines.length === 0 ? (
						<div className="error-logs-empty-state" data-testid="error-logs-empty">
							<p>No error logs found.</p>
						</div>
					) : (
						<div className="error-logs-content-wrap">
							{logTruncated && (
								<p className="form-help-text error-logs-truncated">
									Showing the last {maxLines} lines. Older entries have been truncated.
								</p>
							)}
							<div className="error-logs-content" data-testid="error-logs-content">
								{logLines.map((line, index) => (
									<code key={`${index}-${line}`} className="error-log-entry" data-testid="error-log-entry">
										{line}
									</code>
								))}
							</div>
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
