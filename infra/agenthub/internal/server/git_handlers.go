package server

import (
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"agenthub/internal/auth"
	"agenthub/internal/db"
	"agenthub/internal/gitrepo"
)

func (s *Server) handleGitPush(w http.ResponseWriter, r *http.Request) {
	agent := auth.AgentFromContext(r.Context())

	// Atomic rate limit check + increment
	allowed, err := s.db.CheckAndIncrementRateLimit(agent.ID, "push", s.config.MaxPushesPerHour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rate limit check failed")
		return
	}
	if !allowed {
		writeError(w, http.StatusTooManyRequests, "push rate limit exceeded")
		return
	}

	// Read bundle with size limit
	r.Body = http.MaxBytesReader(w, r.Body, s.config.MaxBundleSize)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "bundle too large")
		return
	}

	// Write to temp file
	tmpFile, err := os.CreateTemp("", "arhub-push-*.bundle")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create temp file")
		return
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(body); err != nil {
		tmpFile.Close()
		writeError(w, http.StatusInternalServerError, "failed to write bundle")
		return
	}
	tmpFile.Close()

	// Unbundle into bare repo
	hashes, err := s.repo.Unbundle(tmpFile.Name())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid bundle: "+err.Error())
		return
	}

	// Index each new commit in the database.
	// Git is the source of truth — if DB indexing fails, the push still succeeded.
	indexed, indexErr := s.indexCommits(hashes, agent.ID)
	if indexErr != nil {
		log.Printf("WARN: git push succeeded but DB indexing failed: %v (hashes=%v)", indexErr, hashes)
	}

	resp := map[string]any{"hashes": indexed}
	if indexErr != nil {
		resp["warning"] = "push succeeded but some commits were not indexed"
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (s *Server) handleGitFetch(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !gitrepo.IsValidHash(hash) {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	if !s.repo.CommitExists(hash) {
		writeError(w, http.StatusNotFound, "commit not found")
		return
	}

	bundlePath, err := s.repo.CreateBundle(hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create bundle")
		return
	}
	defer os.Remove(bundlePath)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename="+hash+".bundle")
	http.ServeFile(w, r, bundlePath)
}

// indexCommits indexes git hashes in the DB within a single transaction.
// Returns the list of indexed hashes and any error encountered.
func (s *Server) indexCommits(hashes []string, agentID string) ([]string, error) {
	var indexed []string
	err := s.db.WithTx(func(tx db.Tx) error {
		for _, hash := range hashes {
			existing, _ := s.db.GetCommitTx(tx, hash)
			if existing != nil {
				indexed = append(indexed, hash)
				continue
			}

			parentHash, message, err := s.repo.GetCommitInfo(hash)
			if err != nil {
				return err
			}

			// Also index the parent if it's not in DB yet (e.g. seed repo commits)
			if parentHash != "" {
				if pc, _ := s.db.GetCommitTx(tx, parentHash); pc == nil {
					pParent, pMsg, _ := s.repo.GetCommitInfo(parentHash)
					s.db.InsertCommitTx(tx, parentHash, pParent, nil, pMsg)
				}
			}

			if err := s.db.InsertCommitTx(tx, hash, parentHash, &agentID, message); err != nil {
				return err
			}
			indexed = append(indexed, hash)
		}
		return nil
	})
	return indexed, err
}

func (s *Server) handleListCommits(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	commits, err := s.db.ListCommits(agentID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if commits == nil {
		commits = []db.Commit{}
	}
	writeJSON(w, http.StatusOK, commits)
}

func (s *Server) handleGetCommit(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !gitrepo.IsValidHash(hash) {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	commit, err := s.db.GetCommit(hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if commit == nil {
		writeError(w, http.StatusNotFound, "commit not found")
		return
	}
	writeJSON(w, http.StatusOK, commit)
}

func (s *Server) handleGetChildren(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !gitrepo.IsValidHash(hash) {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	children, err := s.db.GetChildren(hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if children == nil {
		children = []db.Commit{}
	}
	writeJSON(w, http.StatusOK, children)
}

func (s *Server) handleGetLineage(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !gitrepo.IsValidHash(hash) {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	lineage, err := s.db.GetLineage(hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if lineage == nil {
		lineage = []db.Commit{}
	}
	writeJSON(w, http.StatusOK, lineage)
}

func (s *Server) handleGetLeaves(w http.ResponseWriter, r *http.Request) {
	leaves, err := s.db.GetLeaves()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if leaves == nil {
		leaves = []db.Commit{}
	}
	writeJSON(w, http.StatusOK, leaves)
}

func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	agent := auth.AgentFromContext(r.Context())
	// Atomic rate limit for diffs (CPU-expensive)
	allowed, _ := s.db.CheckAndIncrementRateLimit(agent.ID, "diff", 60)
	if !allowed {
		writeError(w, http.StatusTooManyRequests, "diff rate limit exceeded")
		return
	}

	hashA := r.PathValue("hash_a")
	hashB := r.PathValue("hash_b")
	if !gitrepo.IsValidHash(hashA) || !gitrepo.IsValidHash(hashB) {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	diff, err := s.repo.Diff(hashA, hashB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "diff failed")
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}
