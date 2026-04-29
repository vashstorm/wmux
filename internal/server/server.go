package server

import (
	"context"
	"encoding/json"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/panh/wmux/internal/config"
	"github.com/panh/wmux/internal/protocol"
	"github.com/panh/wmux/internal/session"
)

type Options struct {
	Store  *config.Store
	Assets http.FileSystem
}

type Server struct {
	store             *config.Store
	assets            http.FileSystem
	httpServer        *http.Server
	mux               *http.ServeMux
	sessionManager    session.Manager
	websocketUpgrader websocket.Upgrader
	checkConnectionHealth func(config.ConnectionConfig, string) connectionHealthResponse
}

type healthResponse struct {
	Status string `json:"status"`
}

func New(options Options) *Server {
	if options.Store == nil {
		panic("server options store is required")
	}

	mux := http.NewServeMux()
	srv := &Server{
		store:          options.Store,
		assets:         options.Assets,
		mux:            mux,
		sessionManager: session.NewManager(),
		checkConnectionHealth: checkConnectionHealth,
		websocketUpgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool {
				return true
			},
		},
	}

	srv.registerRoutes()

	cfg := srv.currentConfig()

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
	return sanitized
}

func cloneRequestWithPath(r *http.Request, requestPath string) *http.Request {
	clone := r.Clone(r.Context())
	clone.URL.Path = requestPath
	return clone
}
