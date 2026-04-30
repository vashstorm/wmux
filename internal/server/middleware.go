package server

import (
	"bufio"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

type loggingResponseWriter struct {
	http.ResponseWriter
	status       int
	bytesWritten int
	wroteHeader  bool
}

func (rw *loggingResponseWriter) WriteHeader(code int) {
	if rw.wroteHeader {
		return
	}
	rw.status = code
	rw.wroteHeader = true
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *loggingResponseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHeader {
		rw.WriteHeader(http.StatusOK)
	}
	n, err := rw.ResponseWriter.Write(b)
	rw.bytesWritten += n
	return n, err
}

func (rw *loggingResponseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

func (rw *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return h.Hijack()
}

func (rw *loggingResponseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (rw *loggingResponseWriter) ReadFrom(r io.Reader) (int64, error) {
	if rf, ok := rw.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(r)
	}
	buf := make([]byte, 32*1024)
	var written int64
	for {
		n, err := r.Read(buf)
		if n > 0 {
			nw, werr := rw.Write(buf[:n])
			written += int64(nw)
			if werr != nil {
				return written, werr
			}
			if nw != n {
				return written, io.ErrShortWrite
			}
		}
		if err != nil {
			if err == io.EOF {
				return written, nil
			}
			return written, err
		}
	}
}

func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		rw := &loggingResponseWriter{ResponseWriter: w}

		defer func() {
			if rec := recover(); rec != nil {
				s.logger.Error("handler panic recovered",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.String("remote_addr", s.sanitizeRemoteAddr(r.RemoteAddr)),
					slog.Any("panic", rec),
				)
				if !rw.wroteHeader {
					http.Error(rw, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
				}
			}

			duration := time.Since(start)
			status := rw.status
			if status == 0 {
				status = http.StatusOK
			}

			if r.Method == http.MethodGet && status < 400 {
				return
			}

			level := slog.LevelDebug
			switch {
			case status >= 500:
				level = slog.LevelError
			case status >= 400:
				level = slog.LevelWarn
			}

			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("remote_addr", s.sanitizeRemoteAddr(r.RemoteAddr)),
				slog.Int("status", status),
				slog.Int64("duration_ms", duration.Milliseconds()),
				slog.Int("bytes_written", rw.bytesWritten),
			}

			s.logger.LogAttrs(r.Context(), level, "http request", attrs...)
		}()

		next.ServeHTTP(rw, r)
	})
}

func (s *Server) sanitizeRemoteAddr(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

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
