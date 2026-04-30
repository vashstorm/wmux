package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/server"
	webassets "github.com/panh/wmux/web"
)

var version = "dev"

func main() {
	configPath := flag.String("c", "config.jsonc", "Path to the config file")
	printVersion := flag.Bool("version", false, "Print version and exit")
	printConfigAndExit := flag.Bool("print-config-and-exit", false, "Print validated config JSON and exit")
	flag.Parse()

	if *printVersion {
		fmt.Println(version)
		return
	}

	store, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	expandedConfig, err := store.Config.Expanded()
	if err != nil {
		log.Fatalf("failed to expand config paths: %v", err)
	}
	store.Config = expandedConfig

	if err := store.Config.ValidateAuth(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	if *printConfigAndExit {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(store.Config); err != nil {
			log.Fatalf("failed to print config: %v", err)
		}
		return
	}

	assetFS, err := webassets.StaticFileSystem()
	if err != nil {
		log.Fatalf("failed to load embedded assets: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	srv := server.New(server.Options{
		Store:  store,
		Assets: assetFS,
		Logger: logger,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErrCh := make(chan error, 1)
	go func() {
		serverErrCh <- srv.ListenAndServe()
	}()

	logger.Info("starting wmux",
		slog.String("version", version),
		slog.String("config", *configPath),
		slog.String("bind", "http://"+store.Config.Server.Bind),
	)

	select {
	case err := <-serverErrCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("server stopped with error: %v", err)
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		logger.Info("shutting down wmux", slog.String("reason", ctx.Err().Error()))
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Fatalf("failed to shut down server gracefully: %v", err)
		}

		if err := <-serverErrCh; err != nil && err != http.ErrServerClosed {
			log.Fatalf("server stopped with error: %v", err)
		}

		logger.Info("wmux shutdown complete")
	}
}
