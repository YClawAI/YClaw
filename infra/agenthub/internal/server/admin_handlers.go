package server

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

func (s *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.ID == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	// Check if agent already exists
	existing, err := s.db.GetAgentByID(req.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "agent already exists")
		return
	}

	// Generate random API key
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate api key")
		return
	}
	apiKey := hex.EncodeToString(keyBytes)

	if err := s.db.CreateAgent(req.ID, apiKey); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":      req.ID,
		"api_key": apiKey,
	})
}

