package server

import "net/http"

func (s *Server) registerRoutes() {
	s.handleAPI("GET /api/health", s.handleHealth)

	s.handleAPI("GET /api/connections", s.handleListConnections)
	s.handleAPI("GET /api/connections/health", s.handleListConnectionHealth)
	s.handleAPI("POST /api/connections", s.handleCreateConnection)
	s.handleAPI("GET /api/connections/{id}", s.handleGetConnection)
	s.handleAPI("GET /api/connections/{id}/health", s.handleGetConnectionHealth)
	s.handleAPI("PUT /api/connections/{id}", s.handleUpdateConnection)
	s.handleAPI("DELETE /api/connections/{id}", s.handleDeleteConnection)

	s.handleAPI("GET /api/connections/{id}/sessions", s.handleListSessions)
	s.handleAPI("POST /api/connections/{id}/sessions", s.handleCreateSession)
	s.handleAPI("GET /api/connections/{id}/sessions/{session}/windows", s.handleListWindows)
	s.handleAPI("POST /api/connections/{id}/sessions/{session}/windows", s.handleCreateWindow)
	s.handleAPI("GET /api/connections/{id}/sessions/{session}/windows/{window}/panes", s.handleListPanes)
	s.handleAPI("DELETE /api/connections/{id}/sessions/{session}", s.handleDeleteSession)
	s.handleAPI("PATCH /api/connections/{id}/sessions/{session}", s.handleRenameSession)
	s.handleAPI("DELETE /api/connections/{id}/sessions/{session}/windows/{window}", s.handleDeleteWindow)
	s.handleAPI("POST /api/connections/{id}/sessions/{session}/windows/{window}/panes/{pane}/split", s.handleSplitPane)
	s.handleAPI("DELETE /api/connections/{id}/sessions/{session}/windows/{window}/panes/{pane}", s.handleDeletePane)

	s.handleAPI("GET /api/config", s.handleGetConfig)
	s.handleAPI("PUT /api/config", s.handleUpdateConfig)

	s.handleTerminal("GET /api/terminal", s.handleTerminalWebSocket)
	s.mux.Handle("/", s.loggingMiddleware(http.HandlerFunc(s.handleStatic)))
}

func (s *Server) handleAPI(pattern string, handler http.HandlerFunc) {
	s.mux.Handle(pattern, s.loggingMiddleware(s.authMiddleware(handler, false)))
}

func (s *Server) handleTerminal(pattern string, handler http.HandlerFunc) {
	s.mux.Handle(pattern, s.loggingMiddleware(s.authMiddleware(handler, true)))
}
