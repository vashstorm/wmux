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
2. Add the `voice` section to your `config.jsonc`:

```json
{
  "voice": {
    "enabled": true,
    "dashscopeApiKey": "YOUR_DASHSCOPE_API_KEY_HERE",
    "model": "qwen3.5-omni-flash-realtime",
    "endpoint": "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
    "continuousListening": true,
    "storeRawAudio": false,
    "auditLogPath": null,
    "vadEnabled": true,
    "vadThreshold": 0.5
  }
}
```

### Voice Configuration Options

| Option | Description |
|--------|-------------|
| `enabled` | Turn voice control on or off |
| `dashscopeApiKey` | Your DashScope API key (required when enabled) |
| `model` | Model to use: `qwen3.5-omni-flash-realtime` or `qwen3.5-omni-plus-realtime` |
| `endpoint` | DashScope realtime WebSocket endpoint |
| `continuousListening` | Keep microphone active after each command |
| `storeRawAudio` | Save raw audio recordings to disk |
| `auditLogPath` | Optional path to a JSON-lines audit log file |
| `vadEnabled` | Enable voice activity detection |
| `vadThreshold` | VAD sensitivity (0.0 - 1.0) |

### Privacy Notes

- When `continuousListening` is enabled, the microphone stays active and audio is streamed to DashScope servers.
- Voice interactions are logged (with secrets redacted) if `auditLogPath` is set.
- The DashScope API key is stored only in the backend config file and is never exposed to the frontend.

### Troubleshooting

- **Browser permission denied**: If the microphone does not activate, check your browser's site permissions and ensure microphone access is allowed for the Wmux origin.
- **No voice response**: Verify `dashscopeApiKey` is valid and `voice.enabled` is `true`. Check server logs for connection errors to the DashScope endpoint.

## Known Limitations

- No Windows support
- SSH connections are excluded from V1
- Intelligence/AI analysis is excluded from V1
- No multi-user support
- No terminal history persistence

## License

MIT
