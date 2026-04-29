import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getErrorMessage } from "../api/errors.js";
import { TerminalWebSocket } from "../api/websocket.js";
import { useAppState, type SelectedPane } from "../state/store.js";

const darkTheme: ITheme = {
	background: "#050506",
	foreground: "#e0e0e6",
	cursor: "#00f2ff",
	cursorAccent: "#050506",
	selectionBackground: "rgba(0, 242, 255, 0.2)",
	black: "#1a1a1a",
	red: "#ff2d55",
	green: "#00ff41",
	yellow: "#ffb800",
	blue: "#00f2ff",
	magenta: "#bf00ff",
	cyan: "#00f2ff",
	white: "#e0e0e6",
	brightBlack: "#4d4d4d",
	brightRed: "#ff5e7d",
	brightGreen: "#33ff67",
	brightYellow: "#ffc633",
	brightBlue: "#33f5ff",
	brightMagenta: "#cc33ff",
	brightCyan: "#33f5ff",
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

interface TerminalSize {
	cols: number;
	rows: number;
}

function normalizeTerminalSize(cols: number | undefined, rows: number | undefined): TerminalSize | null {
	if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
	if (!cols || !rows || cols <= 0 || rows <= 0) return null;
	return { cols, rows };
}

export function Terminal({ selectedPane }: TerminalProps) {
	const { setError, uiSettings } = useAppState();
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<TerminalWebSocket | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const [disconnected, setDisconnected] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const fitAndReadSize = useCallback((): TerminalSize | null => {
		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const container = containerRef.current;
		if (!terminal || !fitAddon || !container) return null;

		const proposed = fitAddon.proposeDimensions();
		if (proposed) {
			fitAddon.fit();
		}

		return normalizeTerminalSize(
			proposed?.cols ?? terminal.cols,
			proposed?.rows ?? terminal.rows,
		);
	}, []);

	const connectWebSocket = useCallback((initialSize?: TerminalSize | null) => {
		const token = sessionStorage.getItem("wmux-auth-token") ?? "";
		const terminalSize = initialSize ?? fitAndReadSize();

		setDisconnected(false);
		setErrorMessage(null);

		const ws = new TerminalWebSocket({
			connectionId: selectedPane.connectionId,
			session: selectedPane.session,
			window: selectedPane.window,
			pane: selectedPane.pane,
			rows: terminalSize?.rows,
			cols: terminalSize?.cols,
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
	}, [fitAndReadSize, selectedPane, setError]);

	useEffect(() => {
		if (!containerRef.current) return;

		const terminal = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			customGlyphs: false,
			fontFamily:
				"'CaskaydiaCove Nerd Font', 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', 'Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Sarasa Mono SC', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'PingFang SC', 'Hiragino Sans GB', monospace",
			fontSize: uiSettings.terminalFontSize,
			theme: getXtermTheme(),
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new Unicode11Addon());
		terminal.unicode.activeVersion = "11";
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(containerRef.current);
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		const initialSize = fitAndReadSize();

		terminal.focus();

		terminal.onData((data) => {
			wsRef.current?.send({ type: "input", data });
		});

		terminal.onResize(({ cols, rows }) => {
			wsRef.current?.send({ type: "resize", cols, rows });
		});

		const resizeObserver = new ResizeObserver(() => {
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
			}
			resizeFrameRef.current = window.requestAnimationFrame(() => {
				resizeFrameRef.current = null;
				fitAndReadSize();
			});
		});

		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}

		resizeObserverRef.current = resizeObserver;

		connectWebSocket(initialSize);

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
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
				resizeFrameRef.current = null;
			}
			resizeObserverRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connectWebSocket, uiSettings.terminalFontSize]);

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
