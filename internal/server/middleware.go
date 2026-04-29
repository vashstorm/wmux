package server

import (
	"net/http"
	"strings"
)

func (s *Server) authMiddleware(next http.Handler, allowQueryToken bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(s.currentConfig().Auth.Token)
		if token == "" {
			next.ServeHTTP(w, r)
			return
		}

		if presentedToken := extractBearerToken(r.Header.Get("Authorization")); presentedToken == token {
			next.ServeHTTP(w, r)
			return
		}

		if allowQueryToken && strings.TrimSpace(r.URL.Query().Get("token")) == token {
			next.ServeHTTP(w, r)
			return
		}

		s.writeError(w, http.StatusUnauthorized, "unauthorized", "missing or invalid authentication token")
	})
}

func extractBearerToken(headerValue string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(headerValue, prefix) {
		return ""
	}

	return strings.TrimSpace(strings.TrimPrefix(headerValue, prefix))
}
