# AGENTS.md — Wmux

## Project

Web-based tmux management service. Go backend (HTTP + WebSocket) with React/Vite frontend.

## Prerequisites

- Go 1.26+
- Bun
- tmux (for local management and E2E tests)

## Developer Commands

| Command | What it does |
|---------|-------------|
| `make` / `make build` | Installs web deps, builds frontend to `web/dist`, compiles Go binary to `bin/wmux` |
| `make run` | Builds, then runs `./bin/wmux` (reads `config.jsonc` by default) |
| `make test` | Runs Go unit tests (`go test ./...`) |
| `make typecheck` | Runs `tsc --noEmit` in `web/` |
| `make e2e` | **Builds first**, then runs Playwright E2E tests |
| `make clean` | Removes `bin/` and `web/dist` |

Run order when verifying: `make build` → `make test` → `make typecheck` → `make e2e`.

## Architecture

### Backend (`cmd/wmux/`, `internal/`)

Entry: `cmd/wmux/main.go`. Reads JSONC config, starts HTTP server with graceful shutdown.

Packages:
- `internal/config` — JSONC config loading, validation, thread-safe Store with optimistic concurrency (`ErrConfigModified`). Atomic writes via temp file + rename.
- `internal/server` — HTTP routing (Go 1.22+ pattern matching), auth middleware, REST handlers, WebSocket upgrade.
- `internal/session` — PTY session manager. Bridges WebSocket ↔ PTY with 4 goroutines (read/output/wait/write pumps). Supports local (`creack/pty`) and SSH PTY.
- `internal/sshclient` — SSH connection with key + agent auth, known hosts verification. `Client` and `Remote` types use injectable function fields for testability.
- `internal/tmux` — Local tmux CLI adapter. Format-string parsing, error classification. `Adapter` has injectable `execCommand`/`lookPath` for mocking.
- `internal/protocol` — WebSocket JSON message schema and HTTP error envelope.

REST API routes (all under `/api/`, auth required except `/api/health` and static files):
- Connections CRUD + health: `GET/POST /api/connections`, `GET/PUT/DELETE /api/connections/{id}`, health endpoints
- Sessions/Windows/Panes: `GET/POST/DELETE/PATCH` under `/api/connections/{id}/sessions/...`
- Config: `GET/PUT /api/config`
- Terminal WebSocket: `GET /api/terminal` (auth via Bearer header or `?token=` query param)

Stable API error codes: `unauthorized`, `not_found`, `bad_request`, `conflict`.

### Frontend (`web/`)

Vite 7 + React 18 + TypeScript (strict). Entry: `web/src/main.tsx`.

- State: Single React Context (`AppContext` in `state/store.tsx`) — no Redux/Zustand.
- API: `api/client.ts` wraps `fetch` with Bearer auth from `sessionStorage("wmux-auth-token")`.
- WebSocket: `api/websocket.ts` (`TerminalWebSocket` class) with write queue, auto-reconnect (3 attempts, linear backoff).
- Terminal: `components/Terminal.tsx` integrates xterm.js (`@xterm/xterm`) with `FitAddon` + `WebLinksAddon`. Only the active pane mounts a Terminal instance.
- Components: 16 `.tsx` files in `components/`. Key ones: `Sidebar`, `MainPanel`, `WindowTabs`, `PaneCanvas`, `Terminal`, `SettingsPanel`.
- Styles: CSS files in `styles/` — `tokens.css`, `global.css`, `layout.css`, `components.css` (~1550 lines). No CSS framework.

Frontend is embedded into the Go binary via `web/assets.go` (`//go:embed all:dist`).

## Testing

### Go Tests
- Black-box `_test` packages (never `package server`).
- `httptest` for HTTP handler tests.
- Injectable function fields on `tmux.Adapter` and `sshclient.Client` for mocking `exec.Command` / `ssh.Dial`.
- Real WebSocket dial in terminal tests via `httptest.NewServer`.
- `go test ./...` via `make test`.

### Frontend Unit Tests
- vitest 3 + jsdom + `@testing-library/react`.
- Globals enabled (`describe`, `test`, `expect` available without import).
- Setup: `web/src/test/setup.ts` mocks `ResizeObserver`, `matchMedia`, injects test auth token.
- `vi.mock()` for external deps (xterm, WebSocket, API client).
- Pattern: `src/**/*.test.ts`, `src/**/*.test.tsx`.
- Run: `bun run --cwd web test`.

### E2E Tests (Playwright)
- **Requires tmux installed.** Playwright auto-spawns a detached tmux session for each run.
- **Build first**: `make e2e` runs `make build` before Playwright. `./bin/wmux` must exist and be fresh.
- Playwright config (`playwright.config.ts` at repo root) auto-creates a temp `config.jsonc` and a tmux session `wmux-playwright-{pid}`.
- **Auth injection required**: Every test must set `sessionStorage.setItem("wmux-auth-token", "playwright-token")` via `page.addInitScript()`.
- `session-random-switch.spec.ts` creates 3 extra tmux sessions and uses a seeded PRNG (seed 42) for deterministic random switching.
- `reuseExistingServer: !process.env.CI` — non-CI envs reuse an already-running server. Set `CI=true` for a fresh server.
- Playwright import path in tests: `../../web/node_modules/@playwright/test/index.js` (relative, not package name).
- Run: `make e2e`.

## Style & Conventions

- **Go**: Standard Go formatting. No build tags. Go 1.22+ `http.ServeMux` patterns with `r.PathValue()`.
- **TypeScript**: Strict mode. `noUncheckedIndexedAccess` enabled — array/record index access is `T | undefined`.
- **Imports**: Frontend uses `.js` extensions for all imports (ESM bundler resolution). No path aliases — all relative.
- **No linting/formatting tooling** (no ESLint, Prettier, or pre-commit hooks).
- **No CI** (no `.github/workflows`).

## Config

Runtime config is JSONC (`config.jsonc` by default, ignored by git). Use `-c <path>` for custom path.

Key rules:
- `server.bind` defaults to `127.0.0.1:7331`.
- `auth.token` may be empty **only** when binding to localhost. Non-localhost requires a token.
- SSH paths (`privateKeyPath`, `knownHostsPath`) accept `~` and are expanded at runtime.

Example: `config.example.jsonc`.

## Gotchas

- `make e2e` will fail if `./bin/wmux` is stale. Always build first.
- E2E tests manipulate real tmux sessions. Do not run E2E while using tmux for other work.
- Frontend must be built before Go binary compilation (assets are embedded at build time).
- Playwright generates artifacts in `test-results/` (ignored by git).
