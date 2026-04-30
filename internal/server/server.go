package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/intelligence"
	"github.com/panh/wmux/internal/protocol"
	"github.com/panh/wmux/internal/session"
	"github.com/panh/wmux/internal/tmux"
)

type Options struct {
	Store  *config.Store
	Assets http.FileSystem
	Logger *slog.Logger
}

type Server struct {
	store                 *config.Store
	assets                http.FileSystem
	httpServer            *http.Server
	mux                   *http.ServeMux
	sessionManager        session.Manager
	websocketUpgrader     websocket.Upgrader
	logger                *slog.Logger
	checkConnectionHealth func(config.ConnectionConfig, string) connectionHealthResponse
	intelligenceStore     *intelligence.Store
	intelligenceAnalyzer  *intelligence.Analyzer
}

type healthResponse struct {
	Status string `json:"status"`
}

func New(options Options) *Server {
	if options.Store == nil {
		panic("server options store is required")
	}

	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	mux := http.NewServeMux()
	srv := &Server{
		store:                 options.Store,
		assets:                options.Assets,
		mux:                   mux,
		sessionManager:        session.NewManager(),
		logger:                logger,
		checkConnectionHealth: checkConnectionHealth,
		websocketUpgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool {
				return true
			},
		},
	}

	cfg := srv.currentConfig()
	tmuxAdapter := tmux.NewAdapter(cfg.Tmux.Path)
	if cfg.Intelligence.Enabled {
		dbPath, err := intelligenceDBPath()
		if err != nil {
			logger.Warn("failed to determine intelligence db path, using in-memory fallback", slog.String("error", err.Error()))
			dbPath = ":memory:"
		}

		store, err := intelligence.NewStore(dbPath)
		if err != nil {
			logger.Warn("failed to initialize intelligence store", slog.String("error", err.Error()))
		} else {
			provider, err := intelligence.NewProvider(cfg.Intelligence)
			if err != nil {
				logger.Warn("failed to initialize intelligence provider", slog.String("error", err.Error()))
				_ = store.Close()
			} else {
				srv.intelligenceStore = store
				srv.intelligenceAnalyzer = intelligence.NewAnalyzer(provider, store, cfg.Intelligence.MaxConcurrency, tmuxAdapter.CapturePane)
			}
		}
	}

	srv.registerRoutes()

	srv.httpServer = &http.Server{
		Addr:    cfg.Server.Bind,
		Handler: mux,
	}

	return srv
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) currentConfig() config.Config {
	return s.store.Snapshot()
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
		s.writeError(w, http.StatusNotFound, "not_found", "resource not found")
		return
	}

	requestPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if requestPath == "." || requestPath == "" {
		requestPath = "index.html"
	}

	file, err := s.assets.Open(requestPath)
	if err != nil {
		requestPath = "index.html"
		file, err = s.assets.Open(requestPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if contentType := mime.TypeByExtension(path.Ext(requestPath)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	http.ServeContent(w, cloneRequestWithPath(r, "/"+requestPath), requestPath, stat.ModTime(), file)
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
	}
}

func (s *Server) writeError(w http.ResponseWriter, status int, code, message string) {
	s.logger.Error("http error response",
		slog.Int("status", status),
		slog.String("code", code),
		slog.String("message", message),
	)
	s.writeJSON(w, status, protocol.ErrorResponse{
		Error: protocol.ErrorDetail{
			Code:    code,
			Message: message,
		},
	})
}

func (s *Server) decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

func SanitizeConfig(cfg config.Config) config.Config {
	sanitized := cfg
	sanitized.Auth.Token = ""
	sanitized.Intelligence.APIKey = ""
	return sanitized
}

func cloneRequestWithPath(r *http.Request, requestPath string) *http.Request {
	clone := r.Clone(r.Context())
	clone.URL.Path = requestPath
	return clone
}

func intelligenceDBPath() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		cacheDir = os.TempDir()
	}
	dir := filepath.Join(cacheDir, "wmux")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create intelligence cache dir: %w", err)
	}
	return filepath.Join(dir, "intelligence.db"), nil
}
