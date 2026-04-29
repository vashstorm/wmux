import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getErrorMessage } from "../api/errors.js";
import { TerminalWebSocket } from "../api/websocket.js";
import { useAppState, type SelectedPane } from "../state/store.js";

const darkTheme: ITheme = {
	background: "#201d1d",
	foreground: "#fdfcfc",
	cursor: "#007aff",
	selectionBackground: "#3d3838",
	black: "#201d1d",
	red: "#ff3b30",
	green: "#30d158",
	yellow: "#ff9f0a",
	blue: "#007aff",
	magenta: "#af52de",
	cyan: "#5ac8fa",
	white: "#fdfcfc",
	brightBlack: "#5a5858",
	brightRed: "#ff6961",
	brightGreen: "#30d158",
	brightYellow: "#ffb340",
	brightBlue: "#409cff",
	brightMagenta: "#bf5af2",
	brightCyan: "#64d2ff",
	brightWhite: "#ffffff",
};

const lightTheme: ITheme = {
	background: "#f1eeee",
	foreground: "#201d1d",
	cursor: "#007aff",
	selectionBackground: "#e0dddd",
	black: "#f1eeee",
	red: "#d70015",
	green: "#248a3d",
	yellow: "#cc7f08",
	blue: "#007aff",
	magenta: "#8944ab",
	cyan: "#0071a4",
	white: "#201d1d",
	brightBlack: "#9a9898",
	brightRed: "#ff3b30",
	brightGreen: "#30d158",
	brightYellow: "#ff9f0a",
	brightBlue: "#409cff",
	brightMagenta: "#af52de",
	brightCyan: "#5ac8fa",
	brightWhite: "#424245",
};

function getXtermTheme(): ITheme {
	const theme = document.documentElement.dataset.theme;
	return theme === "light" ? lightTheme : darkTheme;
}

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
		const token = sessionStorage.getItem("wmux-auth-token") ?? "";

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
			fontFamily:
				"'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 14,
			theme: getXtermTheme(),
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

		const themeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (
					mutation.type === "attributes" &&
					mutation.attributeName === "data-theme"
				) {
					terminal.options.theme = getXtermTheme();
				}
			}
		});

		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		return () => {
			themeObserver.disconnect();
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
