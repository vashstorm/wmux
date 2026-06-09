# format: <line>#<hash>#<anchor>|<content>
# use refs exactly as shown in hashline edit/patch tools
.DEFAULT_GOAL := tauri-build

.PHONY: build dev clean test typecheck format e2e tauri-build tauri-e2e tauri-dev icons

TAURI_DRIVER ?= tauri-driver
TAURI_WDIO ?= bun run tauri-e2e
VERSION ?= dev
MACOS_DMG_DIR ?= target/release/bundle/dmg

RUST_SOURCES := $(shell find crates -type f \( -name '*.rs' -o -name 'Cargo.toml' -o -name 'Cargo.lock' \) 2>/dev/null || true)
WEB_SOURCES := $(shell find web/src web/index.html web/package.json web/vite.config.ts web/tsconfig.json -type f 2>/dev/null || true)

ICON_SVG   := web/public/favicon.svg
ICON_OUT   := src-tauri/icons
ICON_STAMP := $(ICON_OUT)/icon.icns

build: tauri-build

web/.bun-install-stamp: web/package.json web/bun.lock
	bun install --cwd web
	@touch $@

web/dist/index.html: $(WEB_SOURCES) web/.bun-install-stamp
	bun run --cwd web build

tauri-build: $(ICON_STAMP)
	bun run --cwd web build
	cargo tauri build

dev: tauri-dev

tauri-dev: $(ICON_STAMP)
	cargo tauri dev

icons: $(ICON_STAMP)

# Regenerate native icon assets whenever favicon.svg changes.
# Requires rsvg-convert (brew install librsvg) and iconutil (macOS built-in).
$(ICON_STAMP): $(ICON_SVG)
	@echo "Generating icons from $(ICON_SVG)…"
	@command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert not found. Install with: brew install librsvg"; exit 1; }
	@mkdir -p /tmp/wmux.iconset $(ICON_OUT)
	@for spec in \
		"icon_16x16.png:16" \
		"icon_16x16@2x.png:32" \
		"icon_32x32.png:32" \
		"icon_32x32@2x.png:64" \
		"icon_128x128.png:128" \
		"icon_128x128@2x.png:256" \
		"icon_256x256.png:256" \
		"icon_256x256@2x.png:512" \
		"icon_512x512.png:512" \
		"icon_512x512@2x.png:1024"; do \
		name=$${spec%%:*}; size=$${spec##*:}; \
		rsvg-convert -w $$size -h $$size $(ICON_SVG) -o /tmp/wmux.iconset/$$name; \
	done
	@cp /tmp/wmux.iconset/icon_512x512.png $(ICON_OUT)/icon.png
	@iconutil -c icns /tmp/wmux.iconset -o $(ICON_STAMP)
	@echo "Done → $(ICON_OUT)/icon.png  $(ICON_STAMP)"

clean:
	rm -rf web/dist web/.bun-install-stamp target src-tauri/target

test:
	cargo test --workspace
	bun run --cwd web test

typecheck:
	bun run --cwd web typecheck

format:
	cargo fmt --all
	bun run --cwd web format

e2e: tauri-e2e

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
		curl -sf http://127.0.0.1:4444/status >/dev/null || { \
			echo "tauri-driver did not become ready; see /tmp/wmux-tauri-driver.log"; \
			exit 1; \
		}; \
		$(TAURI_WDIO)

app: $(ICON_STAMP)
	@if [ "$$(uname -s)" != "Darwin" ]; then \
		echo "build app DMG install flow is only supported on macOS."; \
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