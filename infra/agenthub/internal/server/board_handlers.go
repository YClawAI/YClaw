package server

import (
	"net/http"
	"regexp"
	"strconv"

	"agenthub/internal/auth"
	"agenthub/internal/db"
)

var channelNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,30}$`)

func (s *Server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := s.db.ListChannels()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if channels == nil {
		channels = []db.Channel{}
	}
	writeJSON(w, http.StatusOK, channels)
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !channelNameRe.MatchString(req.Name) {
		writeError(w, http.StatusBadRequest, "channel name must be 1-31 lowercase alphanumeric/dash/underscore chars")
		return
	}

	// Cap total channels at 100
	channels, _ := s.db.ListChannels()
	if len(channels) >= 100 {
		writeError(w, http.StatusForbidden, "channel limit reached")
		return
	}

	// Check if channel already exists
	existing, _ := s.db.GetChannelByName(req.Name)
	if existing != nil {
		writeError(w, http.StatusConflict, "channel already exists")
		return
	}

	if err := s.db.CreateChannel(req.Name, req.Description); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}

	ch, _ := s.db.GetChannelByName(req.Name)
	writeJSON(w, http.StatusCreated, ch)
}

func (s *Server) handleListPosts(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	ch, err := s.db.GetChannelByName(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if ch == nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	posts, err := s.db.ListPosts(ch.ID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if posts == nil {
		posts = []db.Post{}
	}
	writeJSON(w, http.StatusOK, posts)
}

func (s *Server) handleCreatePost(w http.ResponseWriter, r *http.Request) {
	agent := auth.AgentFromContext(r.Context())
	name := r.PathValue("name")

	ch, err := s.db.GetChannelByName(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if ch == nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}

	// Atomic rate limit check + increment
	allowed, err := s.db.CheckAndIncrementRateLimit(agent.ID, "post", s.config.MaxPostsPerHour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rate limit check failed")
		return
	}
	if !allowed {
		writeError(w, http.StatusTooManyRequests, "post rate limit exceeded")
		return
	}

	var req struct {
		Content  string `json:"content"`
		ParentID *int   `json:"parent_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if len(req.Content) > 32*1024 {
		writeError(w, http.StatusBadRequest, "post content too large (max 32KB)")
		return
	}

	// Validate parent post exists and belongs to same channel
	if req.ParentID != nil {
		parent, err := s.db.GetPost(*req.ParentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		if parent == nil {
			writeError(w, http.StatusBadRequest, "parent post not found")
			return
		}
		if parent.ChannelID != ch.ID {
			writeError(w, http.StatusBadRequest, "parent post is in a different channel")
			return
		}
	}

	post, err := s.db.CreatePost(ch.ID, agent.ID, req.ParentID, req.Content)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create post")
		return
	}

	writeJSON(w, http.StatusCreated, post)
}

func (s *Server) handleGetPost(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid post id")
		return
	}

	post, err := s.db.GetPost(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if post == nil {
		writeError(w, http.StatusNotFound, "post not found")
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (s *Server) handleGetReplies(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid post id")
		return
	}

	// Verify post exists
	post, err := s.db.GetPost(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if post == nil {
		writeError(w, http.StatusNotFound, "post not found")
		return
	}

	replies, err := s.db.GetReplies(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if replies == nil {
		replies = []db.Post{}
	}
	writeJSON(w, http.StatusOK, replies)
}
