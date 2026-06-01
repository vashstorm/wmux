# Wmux

Web-based tmux management service with a Rust backend and a Tauri macOS local app.

Wmux V1 focuses on local tmux terminal management. SSH connections and intelligence/AI analysis are intentionally excluded from the V1 runtime scope.

## Prerequisites

- Rust + Cargo
- Bun
- tmux for local management

## Build

```bash
make
# or
make build
```

This installs frontend dependencies, builds the Vite app into `web/dist`, builds the Rust `wmux-server` release binary, and copies it to `bin/wmux`.

For the macOS desktop app:

```bash
make tauri-build
```

## Run

```bash
make run
# or
./bin/wmux -c config.jsonc
```

Useful runtime flags:

```bash
./bin/wmux --version
./bin/wmux --print-config-and-exit -c config.jsonc
```

Startup logs print the binary version, config path, and bind address.

## Clean

```bash
make clean
```

## Test

```bash
make test
make typecheck
make e2e
make tauri-e2e
```

- `make test` runs `cargo test --workspace`.
- `make typecheck` runs the frontend TypeScript checker.
- `make e2e` builds the Rust server and runs Playwright browser E2E tests.
- `make tauri-e2e` builds the Tauri macOS app and runs WebdriverIO desktop E2E tests.

## Configuration

Wmux reads `config.jsonc` by default. Use `-c <path>` to point at a different file.

Example:

```bash
./bin/wmux -c /tmp/wmux.jsonc
```

Config rules:

- JSONC comments are allowed in the config file.
- `server.bind` defaults to `127.0.0.1:7331`.
- `auth.token` may be empty only when binding to localhost.
- Non-localhost bind addresses require a non-empty auth token.
- `path` is the base runtime directory; logs are written under `path/logs/`, and SQLite under `path/data/`.
- Only local tmux connections are active in V1.

Minimal example:

```json
{
  "schemaVersion": 1,
  "path": ".",
  "server": {
    "bind": "127.0.0.1:7331"
  },
  "auth": {
    "token": ""
  },
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

## Usage Examples

```bash
# Start with the default config path
./bin/wmux

# Start with a custom config file
./bin/wmux -c /tmp/wmux.jsonc

# Print the validated runtime config and exit
./bin/wmux --print-config-and-exit -c /tmp/wmux.jsonc
```

## Error Codes

API responses may return these stable error codes:

- `unauthorized`: missing or invalid auth token
- `not_found`: requested API resource was not found
- `bad_request`: invalid request payload or forbidden secret fields
- `conflict`: config file changed on disk and must be reloaded before retrying

## Voice Control Setup

Wmux supports voice control via the Qwen3.5-Omni realtime API. Voice is disabled by default.

### Enabling Voice

1. Obtain a DashScope API key from [Alibaba Cloud DashScope](https://www.alibabacloud.com/help/en/dashscope/)
2. Open **Settings > Voice Control** in the Wmux UI
3. Toggle voice on, paste your API key, and configure options

Voice configuration is managed through the Settings UI and persisted server-side in `config.jsonc`.

### Key Fields

| Field | Description |
|-------|-------------|
| `endpoint` | DashScope base URL for the realtime WebSocket endpoint |
| `dashscopeApiKey` | Your DashScope SK/API Key (required when voice is enabled) |
| `microphoneDisabled` | Safety switch. Set `true` to block all microphone access, overriding other settings |
| `model` | Model to use: `qwen3.5-omni-flash-realtime` or `qwen3.5-omni-plus-realtime` |
| `voice` | TTS voice name, e.g., `Cherry` |
| `continuousListening` | Keep microphone active after each command |
| `storeRawAudio` | Save raw audio to disk. Disabled by default for privacy |
| `vadEnabled` | Enable voice activity detection |
| `vadThreshold` | VAD sensitivity (0.0 - 1.0) |

### Built-in Voice Skills

Wmux ships with predefined voice skills. Skill prompts live under the grouped `skills/` directory, and you can enable/disable them or customize their Markdown prompts through **Settings > Voice Control > Skills**:

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
| `launch_project` / `sync_project_from_tmux` / `generate_project_ai_html` | Operate project dashboards and tmux layouts |
| `analyze_session` / `list_tmux_analysis` / `cleanup_tmux_analysis` | Run and manage Tmux Analysis records |
| `list_ai_logs` / `clear_ai_logs` | Inspect or clear AI Logs |

Skills that perform destructive actions (delete, terminal execution, cleanup, or clear operations) require explicit confirmation through the UI.

### Privacy and Security

- The DashScope API key is stored only in the backend config file. The raw key is **never** sent to the frontend.
- Voice interactions are logged (with secrets redacted) if an audit log path is configured.
- Raw audio is **not** stored in conversation history. Only text transcripts and tool-call results are persisted.
- When `continuousListening` is on, the microphone stays active and audio streams to DashScope. Set `microphoneDisabled: true` to block all microphone access regardless of other settings.

### Troubleshooting

- **Browser permission denied**: Check your browser's site permissions. Ensure microphone access is allowed for the Wmux origin.
- **No voice response**: Verify your API key is valid and voice is enabled in Settings. Check server logs for DashScope connection errors.
- **Microphone blocked locally**: If `microphoneDisabled` is set in your config, the microphone will not activate. Remove or set it to `false` to re-enable.

## Known Limitations

- No Windows support
- SSH connections are excluded from V1
- Intelligence/AI analysis is excluded from V1
- No multi-user support
- No terminal history persistence

## License

MIT
