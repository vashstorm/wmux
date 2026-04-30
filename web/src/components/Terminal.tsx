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
	background: "#0a0e1a",
	foreground: "#f8fafc",
	cursor: "#f59e0b",
	cursorAccent: "#0a0e1a",
	selectionBackground: "rgba(245, 158, 11, 0.2)",
	black: "#0f172a",
	red: "#ef4444",
	green: "#10b981",
	yellow: "#f59e0b",
	blue: "#8b5cf6",
	magenta: "#a855f7",
	cyan: "#06b6d4",
	white: "#f8fafc",
	brightBlack: "#334155",
	brightRed: "#f87171",
	brightGreen: "#34d399",
	brightYellow: "#fbbf24",
	brightBlue: "#a78bfa",
	brightMagenta: "#c084fc",
	brightCyan: "#22d3ee",
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
	const { connectionId, session, window: windowId, pane } = selectedPane;
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<TerminalWebSocket | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const lastSentSizeRef = useRef<TerminalSize | null>(null);
	const [disconnected, setDisconnected] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const fitAndReadSize = useCallback((): TerminalSize | null => {
		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const container = containerRef.current;
		if (!terminal || !fitAddon || !container) return null;

		const proposed = fitAddon.proposeDimensions();
		if (
			proposed &&
			(proposed.cols !== terminal.cols || proposed.rows !== terminal.rows)
		) {
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
		lastSentSizeRef.current = terminalSize;

		setDisconnected(false);
		setErrorMessage(null);

		const ws = new TerminalWebSocket({
			connectionId,
			session,
			window: windowId,
			pane,
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
	}, [connectionId, fitAndReadSize, pane, session, setError, windowId]);

	useEffect(() => {
		if (!containerRef.current) return;

		const terminal = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			customGlyphs: false,
			fontFamily:
				"'CaskaydiaCove Nerd Font', 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', 'Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Sarasa Mono SC', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'PingFang SC', 'Hiragino Sans GB', monospace",
			fontSize: uiSettings.terminalFontSize,
			fontWeight: uiSettings.terminalFontWeight as import("@xterm/xterm").FontWeight,
			fontWeightBold: "bold",
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
			const nextSize = normalizeTerminalSize(cols, rows);
			if (!nextSize) return;
			const previousSize = lastSentSizeRef.current;
			if (
				previousSize &&
				previousSize.cols === nextSize.cols &&
				previousSize.rows === nextSize.rows
			) {
				return;
			}
			lastSentSizeRef.current = nextSize;
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
			lastSentSizeRef.current = null;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connectWebSocket, uiSettings.terminalFontSize, uiSettings.terminalFontWeight]);

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
