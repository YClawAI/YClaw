package auth

import (
	"context"
	"net/http"
	"strings"

	"agenthub/internal/db"
)

type contextKey string

const agentContextKey contextKey = "agent"

func AgentFromContext(ctx context.Context) *db.Agent {
	a, _ := ctx.Value(agentContextKey).(*db.Agent)
	return a
}

// Middleware validates Bearer token against the agents table.
func Middleware(database *db.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := extractBearer(r)
			if key == "" {
				http.Error(w, `{"error":"missing authorization"}`, http.StatusUnauthorized)
				return
			}
			agent, err := database.GetAgentByAPIKey(key)
			if err != nil {
				http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
				return
			}
			if agent == nil {
				http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), agentContextKey, agent)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminMiddleware validates Bearer token against the server's admin key.
func AdminMiddleware(adminKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := extractBearer(r)
			if key == "" || key != adminKey {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return h[7:]
	}
	return ""
}
