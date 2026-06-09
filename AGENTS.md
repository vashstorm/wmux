# AGENTS.md — Wmux

## Project

Tauri v2 macOS desktop app for tmux management. Rust backend communicates with the React/Vite frontend exclusively through Tauri IPC (`invoke()` for request/response, Channel for streaming, Event for notifications). No HTTP server. No browser mode.

## Prerequisites

- Rust + Cargo
- Bun
- tmux (for local management and E2E tests)
- `cargo-tauri` (`cargo install tauri-cli --locked`)
- `tauri-driver` (auto-installed by `make tauri-e2e` if missing)

## Developer Commands

| Command | What it does |
|---------|-------------|
| `make` / `make build` | Builds the Tauri v2 macOS desktop app (`.app` + `.dmg`) |
| `make dev` | Runs `cargo tauri dev` with hot reload |
| `make test` | Runs `cargo test --workspace` then `bun run --cwd web test` |
| `make typecheck` | Runs `tsc --noEmit` in `web/` |
| `make e2e` | Builds Tauri app, starts `tauri-driver`, runs WebdriverIO E2E tests |
| `make tauri-build` | Same as `make build` (explicit target name) |
| `make tauri-e2e` | Same as `make e2e` (explicit target name) |
| `make tauri-dev` | Same as `make dev` (explicit target name) |
| `make clean` | Removes `web/dist`, `web/.bun-install-stamp`, `target/`, `src-tauri/target/` |
| `make format` | Runs `cargo fmt --all` and `bun run --cwd web format` |
| `make icons` | Regenerates native icon assets from `web/public/favicon.svg` |
| `make app` | Builds DMG and opens it (macOS only) |

Run order when verifying: `make build` → `make test` → `make typecheck` → `make e2e`.

## Architecture

### Rust Backend

Two layers:

**Tauri Commands** (`src-tauri/src/commands/`):
12 command modules that expose IPC handlers to the frontend:
- `ai.rs`, `config_cmd.rs`, `connections.rs`, `logs.rs`, `projects.rs`, `sessions.rs`, `skills.rs`, `stream_poc.rs`, `terminal.rs`, `voice.rs`, `voice_history.rs`
- Registered in `mod.rs` and wired in `src-tauri/src/lib.rs` via `generate_handler!`

**Service Layer** (`crates/wmux-core/src/services/`):
8 service modules containing business logic:
- `config.rs`, `connections.rs`, `projects.rs`, `sessions.rs`, `skills.rs`, `terminal.rs`, `voice.rs`
- Shared by Tauri commands. No HTTP/Axum code.

`crates/wmux-core` also contains: config loading/validation, tmux CLI access, terminal session management, and protocol types.

Core runtime scope:
- Local tmux terminal management only for V1.
- SSH connections are intentionally excluded from V1.
- Intelligence/AI analysis is intentionally excluded from V1 (but Qwen3.5-Omni voice control IS a V1-supported capability).

### Frontend (`web/`)

Vite 7 + React 18 + TypeScript (strict). Entry: `web/src/main.tsx`.

- State: Single React Context (`AppContext` in `state/store.tsx`) — no Redux/Zustand.
- IPC: `api/ipc.ts` wraps `invoke()` from `@tauri-apps/api/core` for all backend calls.
- Streaming: `api/terminal.ts` uses Tauri `Channel` for PTY output streaming and `Event` for resize notifications.
- Terminal: `components/Terminal.tsx` integrates xterm.js (`@xterm/xterm`) with `FitAddon` + `WebLinksAddon`. Only the active pane mounts a Terminal instance.
- Components: 16 `.tsx` files in `components/`. Key ones: `Sidebar`, `MainPanel`, `WindowTabs`, `PaneCanvas`, `Terminal`, `SettingsPanel`.
- Styles: CSS files in `styles/` — `tokens.css`, `global.css`, `layout.css`, `components.css`. No CSS framework.

Frontend static files are built to `web/dist` and bundled into the Tauri app via `tauri.conf.json` build config.

### IPC Communication Patterns

| Pattern | Use case | Example |
|---------|----------|---------|
| `invoke()` | Request/response | `invoke('get_config')`, `invoke('list_sessions')` |
| `Channel` | Streaming data | Terminal PTY output, voice events from DashScope |
| `Event` | Notifications | Terminal resize, session changes |

## Testing

### Rust Tests
- Run: `cargo test --workspace` or `make test`.
- `wmux-core` covers config/protocol/tmux/session/service logic.
- V1 SSH and intelligence features must remain unsupported and covered as exclusions where applicable (Qwen3.5-Omni voice control is an exception).

### Frontend Unit Tests
- vitest 3 + jsdom + `@testing-library/react`.
- Globals enabled (`describe`, `test`, `expect` available without import).
- Setup: `web/src/test/setup.ts` mocks `ResizeObserver`, `matchMedia`, Tauri APIs.
- `vi.mock()` for external deps (xterm, Tauri invoke, Channel).
- Pattern: `src/**/*.test.ts`, `src/**/*.test.tsx`.
- Run: `bun run --cwd web test`.

### Tauri E2E Tests (WebdriverIO)
- Requires macOS, `cargo-tauri`, `tauri-driver`, Bun, and tmux.
- `make e2e` runs `make tauri-build`, ensures `tauri-driver` is available (auto-installs if missing), starts it on port 4444, then runs WebdriverIO specs from `tests/tauri/`.
- Tauri uses an in-process Rust backend; tests prepare local config/tmux fixtures before app launch.
- Run: `make e2e`.

## Style & Conventions

- **Rust**: Edition 2024. Prefer small modules, explicit `Result` errors, and `cargo fmt`-compatible formatting.
- **TypeScript**: Strict mode. `noUncheckedIndexedAccess` enabled — array/record index access is `T | undefined`.
- **Imports**: Frontend uses `.js` extensions for all imports (ESM bundler resolution). No path aliases — all relative.
- **No linting/formatting tooling** (no ESLint, Prettier, or pre-commit hooks).
- **No CI** (no `.github/workflows`).

## Config

Runtime config is JSONC (`config.jsonc` by default, ignored by git).

Key rules:
- `server.bind` and `auth.token` are **deprecated** (ignored at runtime). They remain in config for backwards compatibility only.
- Auth is handled by OS-level process isolation (Tauri only allows same-origin IPC).
- V1 supports local tmux connections only. Do not document SSH or intelligence as supported runtime features (Qwen3.5-Omni voice control is an exception).

Example: `config.example.jsonc`.

## Migration from Pre-IPC Versions

Versions before the Tauri IPC migration used a standalone Rust HTTP server (`crates/wmux-server`) with Axum + WebSocket. That architecture has been fully removed:

- **Deleted**: `crates/wmux-server/`, all Axum handlers, HTTP router, WebSocket terminal handler, Bearer token auth.
- **Replaced with**: Tauri command modules in `src-tauri/src/commands/` that call the same `wmux-core` service layer.
- **Frontend change**: `api/client.ts` (fetch + Bearer) replaced by `api/ipc.ts` (Tauri `invoke()`). Terminal WebSocket replaced by Channel-based streaming.
- **Config change**: `server.bind` and `auth.token` are now deprecated and ignored.
- **E2E change**: Playwright browser tests replaced by WebdriverIO Tauri desktop tests.

## Gotchas

- `make e2e` builds the full Tauri app first. This takes time. Use `make dev` for interactive development.
- E2E tests manipulate real tmux sessions. Do not run E2E while using tmux for other work.
- Frontend must be built before Tauri packaging so `web/dist` exists for the app bundle.
- `tauri-driver` is auto-installed by `make tauri-e2e` if not found. Manual install: `cargo install tauri-driver --locked`.
- Icon regeneration (`make icons`) requires `rsvg-convert` (`brew install librsvg`).
