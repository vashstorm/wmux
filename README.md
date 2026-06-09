# Wmux

macOS desktop app for tmux management. Built with Tauri v2, Rust backend, and React/Vite frontend.

> **Breaking Change**: v1.x is a Tauri desktop app only. The standalone HTTP server (`./bin/wmux`), REST API, and browser mode have been removed. The app communicates exclusively through Tauri IPC (`invoke()` + Channel). See migration notes below.

Wmux V1 focuses on local tmux terminal management. SSH connections and intelligence/AI analysis are intentionally excluded from the V1 runtime scope.

## Prerequisites

- Rust + Cargo
- Bun
- tmux
- `cargo-tauri` (install: `cargo install tauri-cli --locked`)
- `tauri-driver` (auto-installed by `make tauri-e2e` if missing)

## Build

```bash
make
# or
make build
```

This builds the Tauri v2 macOS desktop app (bundles `.app` and `.dmg`). Output is under `target/release/bundle/`.

For development with hot reload:

```bash
make dev
```

## Test

```bash
make test          # Rust + frontend unit tests
make typecheck     # TypeScript type checking
make e2e           # Tauri desktop E2E (WebdriverIO)
```

- `make test` runs `cargo test --workspace` and `bun run --cwd web test`.
- `make typecheck` runs `tsc --noEmit` in `web/`.
- `make e2e` builds the Tauri app, starts `tauri-driver`, then runs WebdriverIO specs from `tests/tauri/`.

## Clean

```bash
make clean
```

## Configuration

Wmux reads `config.jsonc` at runtime. JSONC comments are allowed.

Example: `config.example.jsonc`.

Config fields:

| Field | Description |
|-------|-------------|
| `schemaVersion` | Config schema version (currently `1`) |
| `path` | Base runtime directory. Logs go to `<path>/logs/`, SQLite to `<path>/data/` |
| `tmux.path` | Path to the `tmux` binary |
| `connections` | List of tmux connections (only `type: "local"` is active in V1) |
| `ui` | UI settings: `theme`, `fontSize`, `terminalFontSize`, `terminalFontWeight` |
| `logs` | Log settings: `level`, `rotationSizeBytes`, `retentionDays` |
| `omni` | Voice control settings (Qwen3.5-Omni). See Voice Control section below |

Deprecated fields (kept for backwards compatibility, ignored at runtime):

| Field | Notes |
|-------|-------|
| `server.bind` | Was the HTTP server bind address. No HTTP server exists. |
| `auth.token` | Was the Bearer token for API auth. Auth is now OS-level process isolation. |

Minimal config:

```json
{
  "schemaVersion": 1,
  "path": ".",
  "tmux": {
    "path": "tmux"
  },
  "connections": [
    {
      "type": "local"
    }
  ],
  "ui": {
    "theme": "dark"
  }
}
```

## Architecture

Wmux is a Tauri v2 desktop app. There is no HTTP server and no browser mode.

```
┌─────────────────────────────────────────────┐
│  Frontend (React/Vite in WebView)           │
│  invoke() calls + Channel for streaming     │
└────────────────┬────────────────────────────┘
                 │ Tauri IPC
┌────────────────▼────────────────────────────┐
│  Tauri Commands (src-tauri/src/commands/)   │
│  12 command modules, 41+ IPC handlers       │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  Service Layer (crates/wmux-core/src/       │
│                 services/)                   │
│  config, connections, sessions, terminal,    │
│  voice, projects, skills                    │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  tmux CLI / PTY / DashScope WebSocket       │
└─────────────────────────────────────────────┘
```

Communication patterns:

- **`invoke()`** for request/response calls (list sessions, get config, create window, etc.)
- **Channel** for streaming data (terminal PTY output, voice events)
- **Event** for notifications (terminal resize, session changes)

## Voice Control Setup

Wmux supports voice control via the Qwen3.5-Omni realtime API. Voice is disabled by default.

### Enabling Voice

1. Obtain a DashScope API key from [Alibaba Cloud DashScope](https://www.alibabacloud.com/help/en/dashscope/)
2. Open **Settings > Voice Control** in the app
3. Toggle voice on, paste your API key, and configure options

Voice configuration is persisted in `config.jsonc` under the `omni` key. The API key stays in the Rust backend and is **never** exposed to the frontend.

### Key Fields

| Field | Description |
|-------|-------------|
| `endpoint` | DashScope base URL for the realtime WebSocket endpoint |
| `dashscopeApiKey` | Your DashScope SK/API Key (required when voice is enabled) |
| `microphoneDisabled` | Safety switch. Set `true` to block all microphone access |
| `model` | `qwen3.5-omni-flash-realtime` or `qwen3.5-omni-plus-realtime` |
| `voice` | TTS voice name, e.g., `Cherry` |
| `continuousListening` | Keep microphone active after each command |
| `storeRawAudio` | Save raw audio to disk. Disabled by default for privacy |
| `vadEnabled` | Enable voice activity detection |
| `vadThreshold` | VAD sensitivity (0.0 - 1.0) |

### Built-in Voice Skills

Wmux ships with predefined voice skills. Enable/disable or customize them through **Settings > Voice Control > Skills**:

| Skill ID | What it does |
|----------|-------------|
| `navigate_frontend` | Navigate to different UI views |
| `new_chat` | Start a new AI Assistant chat |
| `invoke_backend_route` | Call backend API endpoints |
| `list_sessions` | List active tmux sessions |
| `create_session` | Create a new tmux session |
| `rename_session` | Rename an existing session |
| `delete_session` | Delete a session (requires confirmation) |
| `send_to_pane` | Send text to a specific pane (requires confirmation) |
| `read_pane_output` | Read recent pane output |
| `create_window` / `rename_window` / `delete_window` | Manage tmux windows |
| `split_pane` / `focus_pane` / `kill_pane` / `clear_pane` | Manage tmux panes |
| `list_projects` / `create_project` / `update_project` / `delete_project` | Manage saved projects |
| `launch_project` / `sync_project_from_tmux` / `generate_project_ai_html` | Operate project dashboards |
| `analyze_session` / `list_tmux_analysis` / `cleanup_tmux_analysis` | Run and manage Tmux Analysis records |
| `list_ai_logs` / `clear_ai_logs` | Inspect or clear AI Logs |

Skills that perform destructive actions require explicit confirmation through the UI.

### Privacy and Security

- The DashScope API key is stored only in the Rust backend config. The raw key is **never** sent to the frontend.
- Voice interactions are logged (with secrets redacted) if an audit log path is configured.
- Raw audio is **not** stored in conversation history. Only text transcripts and tool-call results are persisted.
- When `continuousListening` is on, the microphone stays active and audio streams to DashScope. Set `microphoneDisabled: true` to block all microphone access.

### Troubleshooting

- **Microphone permission denied**: Check macOS System Preferences > Security & Privacy > Microphone for the Wmux app.
- **No voice response**: Verify your API key is valid and voice is enabled in Settings. Check logs for DashScope connection errors.
- **Microphone blocked locally**: If `microphoneDisabled` is set in your config, the microphone will not activate. Remove or set it to `false` to re-enable.

## Migration from Pre-IPC Versions

If you used Wmux before the Tauri IPC migration:

| Before (HTTP server) | After (Tauri IPC) |
|---------------------|-------------------|
| `./bin/wmux -c config.jsonc` | Launch the Tauri `.app` |
| `make run` | `make dev` |
| REST API via `fetch()` + Bearer token | `invoke()` from `@tauri-apps/api/core` |
| Terminal WebSocket `/api/terminal` | Tauri Channel for PTY streaming |
| `config.jsonc` with `server.bind` + `auth.token` | Same file, but `server`/`auth` fields are ignored |
| Browser at `http://127.0.0.1:7331` | Native macOS window |

The `crates/wmux-server` crate has been removed. All backend logic now runs in-process through Tauri commands.

## Known Limitations

- macOS only (no Windows or Linux support)
- SSH connections are excluded from V1
- Intelligence/AI analysis is excluded from V1
- No multi-user support
- No terminal history persistence

## License

MIT
