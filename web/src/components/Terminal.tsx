import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getErrorMessage } from "../api/errors.js";
import { getAuthToken } from "../api/runtime.js";
import { TerminalWebSocket } from "../api/websocket.js";
import { useAppState, type SelectedPane } from "../state/store.js";
import { getTerminalTheme } from "../ui/themes.js";

interface TerminalProps {
	selectedPane: SelectedPane;
	windowTheme?: string;
	sourceSize?: TerminalSize | null;
}

interface TerminalSize {
	cols: number;
	rows: number;
}

const TERMINAL_FIT_COLUMN_GUTTER = 2;
const MIN_TERMINAL_COLS = 2;

function normalizeTerminalSize(cols: number | undefined, rows: number | undefined): TerminalSize | null {
	if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
	if (!cols || !rows || cols <= 0 || rows <= 0) return null;
	return { cols, rows };
}

function applyColumnGutter(size: TerminalSize): TerminalSize {
	return {
		cols: Math.max(MIN_TERMINAL_COLS, size.cols - TERMINAL_FIT_COLUMN_GUTTER),
		rows: size.rows,
	};
}

function resolveDisplaySize(fittedSize: TerminalSize | null, sourceSize: TerminalSize | null | undefined): TerminalSize | null {
	if (!fittedSize) return sourceSize ?? null;
	return applyColumnGutter(fittedSize);
}

function redrawTerminal(terminal: XTerm) {
	terminal.clearTextureAtlas();
	terminal.refresh(0, Math.max(0, terminal.rows - 1));
}

export function Terminal({ selectedPane, windowTheme, sourceSize }: TerminalProps) {
	const { setError, uiSettings } = useAppState();
	const { connectionId, session, window: windowId, pane } = selectedPane;
	const wrapperRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<TerminalWebSocket | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const resizeTimeoutRefs = useRef<number[]>([]);
	const lastSentSizeRef = useRef<TerminalSize | null>(null);
	const sourceSizeRef = useRef<TerminalSize | null>(sourceSize ?? null);
	const [disconnected, setDisconnected] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const terminalTheme = getTerminalTheme(windowTheme ?? uiSettings.windowTheme ?? document.documentElement.dataset.theme);
	const terminalStyle = {
		"--terminal-background": terminalTheme.background ?? "var(--color-background)",
	} as CSSProperties;

	const clearDeferredFits = useCallback(() => {
		if (resizeFrameRef.current !== null) {
			window.cancelAnimationFrame(resizeFrameRef.current);
			resizeFrameRef.current = null;
		}
		for (const timeoutId of resizeTimeoutRefs.current) {
			window.clearTimeout(timeoutId);
		}
		resizeTimeoutRefs.current = [];
	}, []);

	const fitAndSyncSize = useCallback((syncWebSocket = false): TerminalSize | null => {
		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const container = containerRef.current;
		if (!terminal || !fitAddon || !container) return null;

		const proposed = fitAddon.proposeDimensions();
		const fittedSize = normalizeTerminalSize(
			proposed?.cols ?? terminal.cols,
			proposed?.rows ?? terminal.rows,
		);
		const nextSize = resolveDisplaySize(fittedSize, sourceSizeRef.current);
		if (
			nextSize &&
			(nextSize.cols !== terminal.cols || nextSize.rows !== terminal.rows)
		) {
			terminal.resize(nextSize.cols, nextSize.rows);
		}
		redrawTerminal(terminal);

		if (syncWebSocket && nextSize) {
			const previousSize = lastSentSizeRef.current;
			if (
				!previousSize ||
				previousSize.cols !== nextSize.cols ||
				previousSize.rows !== nextSize.rows
			) {
				lastSentSizeRef.current = nextSize;
				wsRef.current?.send({ type: "resize", cols: nextSize.cols, rows: nextSize.rows });
			}
		}

		return nextSize;
	}, []);

	const scheduleDeferredFit = useCallback(() => {
		clearDeferredFits();

		resizeFrameRef.current = window.requestAnimationFrame(() => {
			resizeFrameRef.current = null;
			fitAndSyncSize(true);
		});

		for (const delay of [80, 240, 500]) {
			const timeoutId = window.setTimeout(() => {
				resizeTimeoutRefs.current = resizeTimeoutRefs.current.filter((id) => id !== timeoutId);
				fitAndSyncSize(true);
			}, delay);
			resizeTimeoutRefs.current.push(timeoutId);
		}
	}, [clearDeferredFits, fitAndSyncSize]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		terminal.options.fontSize = uiSettings.terminalFontSize;
		fitAndSyncSize(true);
	}, [fitAndSyncSize, uiSettings.terminalFontSize]);

	useEffect(() => {
		sourceSizeRef.current = sourceSize ?? null;
		fitAndSyncSize(true);
	}, [fitAndSyncSize, sourceSize]);

	const connectWebSocket = useCallback((initialSize?: TerminalSize | null) => {
		const token = getAuthToken() ?? "";
		const terminalSize = initialSize ?? fitAndSyncSize();
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
				setError(null);
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
	}, [connectionId, fitAndSyncSize, pane, session, setError, windowId]);

	useEffect(() => {
		if (!containerRef.current) return;

		const terminal = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			customGlyphs: false,
			scrollback: 0,
			fontFamily:
				"'CaskaydiaCove Nerd Font', 'Berkeley Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', 'Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Sarasa Mono SC', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'PingFang SC', 'Hiragino Sans GB', monospace",
			fontSize: uiSettings.terminalFontSize,
			fontWeight: uiSettings.terminalFontWeight as import("@xterm/xterm").FontWeight,
			fontWeightBold: "bold",
			theme: getTerminalTheme(windowTheme ?? document.documentElement.dataset.theme),
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new Unicode11Addon());
		terminal.unicode.activeVersion = "11";
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(containerRef.current);
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		const initialSize = fitAndSyncSize();

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
			scheduleDeferredFit();
		});

		if (wrapperRef.current) {
			resizeObserver.observe(wrapperRef.current);
		}
		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}

		resizeObserverRef.current = resizeObserver;

		connectWebSocket(initialSize);

		scheduleDeferredFit();
		window.addEventListener("resize", scheduleDeferredFit);

		const fontSet = document.fonts;
		if (fontSet) {
			void fontSet.ready.then(() => {
				scheduleDeferredFit();
			});
		}

		const themeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (
					mutation.type === "attributes" &&
					mutation.attributeName === "data-theme"
				) {
					terminal.options.theme = getTerminalTheme(windowTheme ?? document.documentElement.dataset.theme);
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
			window.removeEventListener("resize", scheduleDeferredFit);
			clearDeferredFits();
			resizeObserverRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			lastSentSizeRef.current = null;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [clearDeferredFits, connectWebSocket, fitAndSyncSize, scheduleDeferredFit, uiSettings.terminalFontSize, uiSettings.terminalFontWeight]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		terminal.options.theme = getTerminalTheme(windowTheme ?? document.documentElement.dataset.theme);
	}, [windowTheme]);

	const handleReconnect = () => {
		wsRef.current?.close();
		connectWebSocket();
	};

	return (
		<div
			ref={wrapperRef}
			className="terminal-wrapper"
			style={terminalStyle}
			data-testid="terminal-wrapper"
		>
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
