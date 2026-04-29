.DEFAULT_GOAL := build

.PHONY: build run clean test typecheck e2e

PLAYWRIGHT ?= ./web/node_modules/.bin/playwright test -c playwright.config.ts
VERSION ?= dev

build:
	bun install --cwd web
	bun run --cwd web build
	mkdir -p bin
	go build -ldflags "-X main.version=$(VERSION)" -o bin/webmux ./cmd/webmux

run: build
	./bin/webmux

clean:
	rm -rf bin web/dist

test:
	go test ./...

typecheck:
	bun run --cwd web typecheck

e2e:
	$(MAKE) build
	$(PLAYWRIGHT)
