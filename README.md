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
- Only local tmux connections are active in V1.

Minimal example:

```json
{
  "schemaVersion": 1,
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

## Known Limitations

- No Windows support
- SSH connections are excluded from V1
- Intelligence/AI analysis is excluded from V1
- No multi-user support
- No terminal history persistence

## License

MIT
