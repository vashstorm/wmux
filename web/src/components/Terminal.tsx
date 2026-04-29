import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getErrorMessage } from "../api/errors.js";
import { TerminalWebSocket } from "../api/websocket.js";
import { useAppState, type SelectedPane } from "../state/store.js";

interface TerminalProps {
	selectedPane: SelectedPane;
}

export function Terminal({ selectedPane }: TerminalProps) {
	const { setError } = useAppState();
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<TerminalWebSocket | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const [disconnected, setDisconnected] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const connectWebSocket = useCallback(() => {
		const token = sessionStorage.getItem("wmux-auth-token");
		if (!token) {
			setErrorMessage("Authentication token not found");
			return;
		}

		setDisconnected(false);
		setErrorMessage(null);

		const ws = new TerminalWebSocket({
			connectionId: selectedPane.connectionId,
			session: selectedPane.session,
			window: selectedPane.window,
			pane: selectedPane.pane,
			token,
			onMessage: (message) => {
					switch (message.type) {
					case "output": {
						terminalRef.current?.write(message.data);
						break;
					}
					case "status": {
						terminalRef.current?.writeln(`\r\n[status: ${message.status}]\r\n`);
						break;
					}
					case "error": {
						setError({
							code: message.error.code,
							message: getErrorMessage(message.error.code, message.error.message),
						});
						terminalRef.current?.writeln(
							`\r\n[error: ${message.error.code}] ${message.error.message}\r\n`,
						);
						break;
					}
					case "close": {
						setDisconnected(true);
						break;
					}
				}
			},
			onOpen: () => {
				setDisconnected(false);
				setErrorMessage(null);
			},
			onClose: () => {
				setDisconnected(true);
			},
			onError: () => {
				setErrorMessage("WebSocket connection failed");
			},
		});

		ws.connect();
		wsRef.current = ws;
	}, [selectedPane, setError]);

	useEffect(() => {
		if (!containerRef.current) return;

		const terminal = new XTerm({
			cursorBlink: true,
			fontFamily: "var(--font-mono)",
			fontSize: 14,
			theme: {
				background: "#0d1117",
				foreground: "#e6edf3",
				cursor: "#58a6ff",
				selectionBackground: "#264f78",
				black: "#010409",
				red: "#ff7b72",
				green: "#3fb950",
				yellow: "#d29922",
				blue: "#58a6ff",
				magenta: "#bc8cff",
				cyan: "#76e3ea",
				white: "#b1bac4",
				brightBlack: "#484f58",
				brightRed: "#ffa198",
				brightGreen: "#56d364",
				brightYellow: "#e3b341",
				brightBlue: "#79c0ff",
				brightMagenta: "#d2a8ff",
				brightCyan: "#b3f0ff",
				brightWhite: "#ffffff",
			},
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(containerRef.current);
		fitAddon.fit();

		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;

		terminal.onData((data) => {
			wsRef.current?.send({ type: "input", data });
		});

		terminal.onResize(({ cols, rows }) => {
			wsRef.current?.send({ type: "resize", cols, rows });
		});

		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
		});

		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}

		resizeObserverRef.current = resizeObserver;

		connectWebSocket();

		return () => {
			resizeObserver.disconnect();
			resizeObserverRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connectWebSocket]);

	const handleReconnect = () => {
		wsRef.current?.close();
		connectWebSocket();
	};

	return (
		<div className="terminal-wrapper" data-testid="terminal-wrapper">
			<div
				ref={containerRef}
				className="terminal-container"
				data-testid="terminal"
			/>
			{disconnected && (
				<div
					className="terminal-disconnected-overlay"
					data-testid="terminal-disconnected"
				>
					<div className="terminal-disconnected-content">
						<p className="terminal-disconnected-text">
							Disconnected from terminal
						</p>
						{errorMessage && (
							<p className="terminal-disconnected-error">{errorMessage}</p>
						)}
						<button
							type="button"
							className="terminal-reconnect-btn"
							onClick={handleReconnect}
							data-testid="reconnect-button"
						>
							Reconnect
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
