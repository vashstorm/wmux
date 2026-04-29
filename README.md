# Webmux

Web-based tmux management service.

## Prerequisites

- Go 1.22+
- Bun
- tmux for local management

## Build

```bash
make
# or
make build
```

This builds the frontend into `web/dist` and produces the server binary at `bin/webmux`.

## Run

```bash
make run
# or
./bin/webmux -c config.jsonc
```

Useful runtime flags:

```bash
./bin/webmux --version
./bin/webmux --print-config-and-exit -c config.jsonc
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
```

## Configuration

Webmux reads `config.jsonc` by default. Use `-c <path>` to point at a different file.

Example:

```bash
./bin/webmux -c /tmp/webmux.jsonc
```

Config rules:

- JSONC comments are allowed in the config file.
- `server.bind` defaults to `127.0.0.1:7331`.
- `auth.token` may be empty only when binding to localhost.
- Non-localhost bind addresses require a non-empty auth token.
- SSH connection `privateKeyPath` and `knownHostsPath` accept `~` and are expanded at runtime.

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
      "name": "local",
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
./bin/webmux

# Start with a custom config file
./bin/webmux -c /tmp/webmux.jsonc

# Print the validated runtime config and exit
./bin/webmux --print-config-and-exit -c /tmp/webmux.jsonc
```

## Error Codes

API responses may return these stable error codes:

- `unauthorized`: missing or invalid auth token
- `not_found`: requested API resource was not found
- `bad_request`: invalid request payload or forbidden secret fields
- `conflict`: config file changed on disk and must be reloaded before retrying

## Known Limitations

- No Windows support
- No SSH password authentication
- No multi-user support
- No terminal history persistence

## License

MIT
