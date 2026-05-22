.DEFAULT_GOAL := build

.PHONY: build dev clean test typecheck e2e tauri-build tauri-e2e tauri-dev build-app

PLAYWRIGHT ?= ./web/node_modules/.bin/playwright test -c playwright.config.ts
TAURI_DRIVER ?= tauri-driver
TAURI_WDIO ?= bun run tauri-e2e
VERSION ?= dev
MACOS_DMG_DIR ?= target/release/bundle/dmg

RUST_SOURCES := $(shell find crates -type f \( -name '*.rs' -o -name 'Cargo.toml' -o -name 'Cargo.lock' \))
WEB_SOURCES := $(shell find web/src web/index.html web/package.json web/vite.config.ts web/tsconfig.json -type f 2>/dev/null)

build: bin/wmux

web/.bun-install-stamp: web/package.json web/bun.lock
	bun install --cwd web
	@touch $@

web/dist/index.html: $(WEB_SOURCES) web/.bun-install-stamp
	bun run --cwd web build

target/release/wmux-server: $(RUST_SOURCES)
	WMUX_VERSION=$(VERSION) cargo build --release -p wmux-server

bin/wmux: target/release/wmux-server web/dist/index.html
	mkdir -p bin
	rm -f bin/wmux
	cp target/release/wmux-server bin/wmux

dev: bin/wmux
	exec ./bin/wmux

clean:
	rm -rf bin web/dist web/.bun-install-stamp target src-tauri/target

test:
	cargo test --workspace

typecheck:
	bun run --cwd web typecheck

e2e:
	$(MAKE) build
	CI=true $(PLAYWRIGHT)

tauri-dev:
	cargo tauri dev

tauri-build:
	cargo tauri build

build-app:
	@if [ "$$(uname -s)" != "Darwin" ]; then \
		echo "build-app DMG install flow is only supported on macOS."; \
		exit 1; \
	fi
	cargo tauri build --bundles dmg
	@dmg_path="$$(ls -t "$(MACOS_DMG_DIR)"/*.dmg 2>/dev/null | head -n 1)"; \
		if [ -z "$$dmg_path" ]; then \
			echo "Built DMG not found under $(MACOS_DMG_DIR)."; \
			exit 1; \
		fi; \
		open "$$dmg_path"; \
		echo "Opened $$dmg_path"

tauri-e2e:
	$(MAKE) tauri-build
	bun install
	@if ! command -v tmux >/dev/null 2>&1; then \
		echo "tmux not found; Tauri E2E specs will skip."; \
	fi
	@if ! command -v $(TAURI_DRIVER) >/dev/null 2>&1; then \
		echo "tauri-driver not found; installing with cargo install tauri-driver --locked"; \
		cargo install tauri-driver --locked; \
	fi
	@set -e; \
		$(TAURI_DRIVER) > /tmp/wmux-tauri-driver.log 2>&1 & \
		driver_pid=$$!; \
		cleanup() { \
			kill $$driver_pid >/dev/null 2>&1 || true; \
			wait $$driver_pid 2>/dev/null || true; \
		}; \
		trap cleanup EXIT INT TERM; \
		for attempt in $$(seq 1 50); do \
			if ! kill -0 $$driver_pid >/dev/null 2>&1; then \
				echo "tauri-driver exited early; see /tmp/wmux-tauri-driver.log"; \
				exit 1; \
			fi; \
			if curl -sf http://127.0.0.1:4444/status >/dev/null 2>&1; then \
				break; \
			fi; \
			sleep 0.2; \
		done; \
		curl -sf http://127.0.0.1:4444/status >/dev/null 2>&1 || { \
			echo "tauri-driver did not become ready; see /tmp/wmux-tauri-driver.log"; \
			exit 1; \
		}; \
		$(TAURI_WDIO)
