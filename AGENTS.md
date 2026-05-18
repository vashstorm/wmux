# AGENTS.md — Wmux

## Project

Web-based tmux management service. Rust backend (Axum + WebSocket), React/Vite frontend, and Tauri v2 macOS local app.

## Prerequisites

- Rust + Cargo
- Bun
- tmux (for local management and E2E tests)

## Developer Commands

| Command | What it does |
|---------|-------------|
| `make` / `make build` | Installs web deps, builds frontend to `web/dist`, compiles Rust `wmux-server`, copies it to `bin/wmux` |
| `make run` | Builds, then runs `./bin/wmux` (reads `config.jsonc` by default) |
| `make test` | Runs Rust workspace tests (`cargo test --workspace`) |
| `make typecheck` | Runs `tsc --noEmit` in `web/` |
| `make e2e` | **Builds first**, then runs Playwright E2E tests |
| `make tauri-build` | Builds the Tauri v2 macOS desktop app |
| `make tauri-e2e` | Builds the Tauri app, starts `tauri-driver`, then runs WebdriverIO E2E tests |
| `make clean` | Removes `bin/` and `web/dist` |

Run order when verifying: `make build` → `make test` → `make typecheck` → `make e2e`.

## Architecture

### Rust Backend (`crates/`)

Workspace members:
- `crates/wmux-core` — shared Rust library for config loading/validation, tmux CLI access, terminal session management, protocol types, Axum handlers/router used by the in-process app, and Tauri backend startup helpers.
- `crates/wmux-server` — standalone CLI/server binary. Entry: `crates/wmux-server/src/main.rs`. Reads JSONC config, validates auth, serves `web/dist`, and starts the Axum HTTP/WebSocket server with graceful shutdown.
- `src-tauri` — Tauri v2 macOS app. Starts an in-process local backend on `127.0.0.1:0`, injects runtime base URL/token into the WebView, and serves the Vite build from `web/dist`.

Core runtime scope:
- Local tmux terminal management only for V1.
- SSH connections are intentionally excluded from V1.
- Intelligence/AI analysis is intentionally excluded from V1.

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

Frontend static files are built to `web/dist` and served directly by the Rust server/Tauri in-process backend.

## Testing

### Rust Tests
- Run: `cargo test --workspace` or `make test`.
- `wmux-core` covers config/protocol/tmux/session logic.
- `wmux-server` covers Axum routes, auth, config, connections, and local terminal API behavior.
- V1 SSH and intelligence endpoints must remain unsupported and covered as exclusions where applicable.

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

### Tauri E2E Tests
- Requires macOS desktop dependencies, `cargo-tauri`, `tauri-driver`, Bun, and tmux.
- `make tauri-e2e` runs `make tauri-build`, ensures `tauri-driver` is available, starts it on port 4444, then runs WebdriverIO specs from `tests/tauri/`.
- Tauri uses an in-process Rust backend with an injected per-launch token; tests prepare local config/tmux fixtures before app launch.

## Style & Conventions

- **Rust**: Edition 2024. Prefer small modules, explicit `Result` errors, and `cargo fmt`-compatible formatting.
- **TypeScript**: Strict mode. `noUncheckedIndexedAccess` enabled — array/record index access is `T | undefined`.
- **Imports**: Frontend uses `.js` extensions for all imports (ESM bundler resolution). No path aliases — all relative.
- **No linting/formatting tooling** (no ESLint, Prettier, or pre-commit hooks).
- **No CI** (no `.github/workflows`).

## Config

Runtime config is JSONC (`config.jsonc` by default, ignored by git). Use `-c <path>` for custom path.

Key rules:
- `server.bind` defaults to `127.0.0.1:7331`.
- `auth.token` may be empty **only** when binding to localhost. Non-localhost requires a token.
- V1 supports local tmux connections only. Do not document SSH or intelligence as supported runtime features.

Example: `config.example.jsonc`.

## Gotchas

- `make e2e` will fail if `./bin/wmux` is stale. Always build first.
- E2E tests manipulate real tmux sessions. Do not run E2E while using tmux for other work.
- Frontend must be built before Rust server/Tauri packaging so `web/dist` exists.
- Playwright generates artifacts in `test-results/` (ignored by git).
