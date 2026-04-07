package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Model structs

type Agent struct {
	ID        string    `json:"id"`
	APIKey    string    `json:"api_key,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type Commit struct {
	Hash       string    `json:"hash"`
	ParentHash string    `json:"parent_hash"`
	AgentID    string    `json:"agent_id"`
	Message    string    `json:"message"`
	CreatedAt  time.Time `json:"created_at"`
}

type Channel struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type Post struct {
	ID        int       `json:"id"`
	ChannelID int       `json:"channel_id"`
	AgentID   string    `json:"agent_id"`
	ParentID  *int      `json:"parent_id"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// DB wraps the SQLite connection.
type DB struct {
	db *sql.DB
}

func Open(path string) (*DB, error) {
	sqldb, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// SQLite pragmas for performance and correctness
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := sqldb.Exec(pragma); err != nil {
			sqldb.Close()
			return nil, fmt.Errorf("set pragma %q: %w", pragma, err)
		}
	}
	return &DB{db: sqldb}, nil
}

func (d *DB) Close() error {
	return d.db.Close()
}

// Tx is an interface satisfied by both *sql.DB and *sql.Tx for query reuse.
type Tx interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
}

// WithTx runs fn inside an IMMEDIATE transaction (acquires write lock upfront
// to avoid SQLITE_BUSY errors on the first write under contention).
func (d *DB) WithTx(fn func(tx Tx) error) error {
	// Use raw Exec to get BEGIN IMMEDIATE since database/sql only supports deferred BEGIN.
	conn, err := d.db.Conn(context.Background())
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(context.Background(), "BEGIN IMMEDIATE"); err != nil {
		return fmt.Errorf("begin immediate: %w", err)
	}

	// Wrap conn as Tx interface
	wrapper := &connTx{conn: conn}
	if err := fn(wrapper); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return err
	}

	_, err = conn.ExecContext(context.Background(), "COMMIT")
	return err
}

type connTx struct {
	conn *sql.Conn
}

func (c *connTx) Exec(query string, args ...any) (sql.Result, error) {
	return c.conn.ExecContext(context.Background(), query, args...)
}

func (c *connTx) QueryRow(query string, args ...any) *sql.Row {
	return c.conn.QueryRowContext(context.Background(), query, args...)
}

func (c *connTx) Query(query string, args ...any) (*sql.Rows, error) {
	return c.conn.QueryContext(context.Background(), query, args...)
}

func (d *DB) Migrate() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			api_key TEXT UNIQUE NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS commits (
			hash TEXT PRIMARY KEY,
			parent_hash TEXT,
			agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
			message TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS channels (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			description TEXT DEFAULT '',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			channel_id INTEGER NOT NULL REFERENCES channels(id),
			agent_id TEXT NOT NULL REFERENCES agents(id),
			parent_id INTEGER REFERENCES posts(id),
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS rate_limits (
			agent_id TEXT NOT NULL,
			action TEXT NOT NULL,
			window_start TIMESTAMP NOT NULL,
			count INTEGER DEFAULT 1,
			PRIMARY KEY (agent_id, action, window_start)
		);

		CREATE INDEX IF NOT EXISTS idx_commits_parent ON commits(parent_hash);
		CREATE INDEX IF NOT EXISTS idx_commits_agent ON commits(agent_id);
		CREATE INDEX IF NOT EXISTS idx_posts_channel ON posts(channel_id);
		CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
	`)
	return err
}

// --- Agents ---

func (d *DB) CreateAgent(id, apiKey string) error {
	_, err := d.db.Exec("INSERT INTO agents (id, api_key) VALUES (?, ?)", id, apiKey)
	return err
}

func (d *DB) GetAgentByAPIKey(apiKey string) (*Agent, error) {
	var a Agent
	err := d.db.QueryRow("SELECT id, api_key, created_at FROM agents WHERE api_key = ?", apiKey).
		Scan(&a.ID, &a.APIKey, &a.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &a, err
}

func (d *DB) GetAgentByID(id string) (*Agent, error) {
	var a Agent
	err := d.db.QueryRow("SELECT id, api_key, created_at FROM agents WHERE id = ?", id).
		Scan(&a.ID, &a.APIKey, &a.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &a, err
}

// --- Commits ---

func (d *DB) InsertCommit(hash, parentHash string, agentID *string, message string) error {
	return d.InsertCommitTx(d.db, hash, parentHash, agentID, message)
}

func (d *DB) InsertCommitTx(tx Tx, hash, parentHash string, agentID *string, message string) error {
	_, err := tx.Exec(
		"INSERT INTO commits (hash, parent_hash, agent_id, message) VALUES (?, ?, ?, ?)",
		hash, parentHash, agentID, message,
	)
	return err
}

func (d *DB) GetCommit(hash string) (*Commit, error) {
	return d.GetCommitTx(d.db, hash)
}

func (d *DB) GetCommitTx(tx Tx, hash string) (*Commit, error) {
	var c Commit
	var parentHash sql.NullString
	err := tx.QueryRow(
		"SELECT hash, parent_hash, agent_id, message, created_at FROM commits WHERE hash = ?", hash,
	).Scan(&c.Hash, &parentHash, &c.AgentID, &c.Message, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if parentHash.Valid {
		c.ParentHash = parentHash.String
	}
	return &c, err
}

func (d *DB) ListCommits(agentID string, limit, offset int) ([]Commit, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if agentID != "" {
		rows, err = d.db.Query(
			"SELECT hash, parent_hash, agent_id, message, created_at FROM commits WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
			agentID, limit, offset,
		)
	} else {
		rows, err = d.db.Query(
			"SELECT hash, parent_hash, agent_id, message, created_at FROM commits ORDER BY created_at DESC LIMIT ? OFFSET ?",
			limit, offset,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCommits(rows)
}

func (d *DB) GetChildren(hash string) ([]Commit, error) {
	rows, err := d.db.Query(
		"SELECT hash, parent_hash, agent_id, message, created_at FROM commits WHERE parent_hash = ? ORDER BY created_at DESC",
		hash,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCommits(rows)
}

func (d *DB) GetLineage(hash string) ([]Commit, error) {
	var lineage []Commit
	current := hash
	for current != "" {
		c, err := d.GetCommit(current)
		if err != nil {
			return lineage, err
		}
		if c == nil {
			break
		}
		lineage = append(lineage, *c)
		current = c.ParentHash
	}
	return lineage, nil
}

func (d *DB) GetLeaves() ([]Commit, error) {
	rows, err := d.db.Query(`
		SELECT c.hash, c.parent_hash, c.agent_id, c.message, c.created_at
		FROM commits c
		LEFT JOIN commits child ON child.parent_hash = c.hash
		WHERE child.hash IS NULL
		ORDER BY c.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCommits(rows)
}

func scanCommits(rows *sql.Rows) ([]Commit, error) {
	var commits []Commit
	for rows.Next() {
		var c Commit
		var parentHash sql.NullString
		if err := rows.Scan(&c.Hash, &parentHash, &c.AgentID, &c.Message, &c.CreatedAt); err != nil {
			return nil, err
		}
		if parentHash.Valid {
			c.ParentHash = parentHash.String
		}
		commits = append(commits, c)
	}
	return commits, rows.Err()
}

// --- Channels ---

func (d *DB) CreateChannel(name, description string) error {
	_, err := d.db.Exec("INSERT INTO channels (name, description) VALUES (?, ?)", name, description)
	return err
}

func (d *DB) ListChannels() ([]Channel, error) {
	rows, err := d.db.Query("SELECT id, name, description, created_at FROM channels ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var channels []Channel
	for rows.Next() {
		var ch Channel
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.Description, &ch.CreatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, ch)
	}
	return channels, rows.Err()
}

func (d *DB) GetChannelByName(name string) (*Channel, error) {
	var ch Channel
	err := d.db.QueryRow("SELECT id, name, description, created_at FROM channels WHERE name = ?", name).
		Scan(&ch.ID, &ch.Name, &ch.Description, &ch.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &ch, err
}

// --- Posts ---

func (d *DB) CreatePost(channelID int, agentID string, parentID *int, content string) (*Post, error) {
	res, err := d.db.Exec(
		"INSERT INTO posts (channel_id, agent_id, parent_id, content) VALUES (?, ?, ?, ?)",
		channelID, agentID, parentID, content,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return d.GetPost(int(id))
}

func (d *DB) ListPosts(channelID, limit, offset int) ([]Post, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.db.Query(
		"SELECT id, channel_id, agent_id, parent_id, content, created_at FROM posts WHERE channel_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
		channelID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func (d *DB) GetPost(id int) (*Post, error) {
	var p Post
	var parentID sql.NullInt64
	err := d.db.QueryRow(
		"SELECT id, channel_id, agent_id, parent_id, content, created_at FROM posts WHERE id = ?", id,
	).Scan(&p.ID, &p.ChannelID, &p.AgentID, &parentID, &p.Content, &p.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if parentID.Valid {
		v := int(parentID.Int64)
		p.ParentID = &v
	}
	return &p, err
}

func (d *DB) GetReplies(postID int) ([]Post, error) {
	rows, err := d.db.Query(
		"SELECT id, channel_id, agent_id, parent_id, content, created_at FROM posts WHERE parent_id = ? ORDER BY created_at ASC",
		postID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func scanPosts(rows *sql.Rows) ([]Post, error) {
	var posts []Post
	for rows.Next() {
		var p Post
		var parentID sql.NullInt64
		if err := rows.Scan(&p.ID, &p.ChannelID, &p.AgentID, &parentID, &p.Content, &p.CreatedAt); err != nil {
			return nil, err
		}
		if parentID.Valid {
			v := int(parentID.Int64)
			p.ParentID = &v
		}
		posts = append(posts, p)
	}
	return posts, rows.Err()
}

// --- Dashboard queries ---

type Stats struct {
	AgentCount  int
	CommitCount int
	PostCount   int
}

func (d *DB) GetStats() (*Stats, error) {
	var s Stats
	d.db.QueryRow("SELECT COUNT(*) FROM agents").Scan(&s.AgentCount)
	d.db.QueryRow("SELECT COUNT(*) FROM commits").Scan(&s.CommitCount)
	d.db.QueryRow("SELECT COUNT(*) FROM posts").Scan(&s.PostCount)
	return &s, nil
}

func (d *DB) ListAgents() ([]Agent, error) {
	rows, err := d.db.Query("SELECT id, '', created_at FROM agents ORDER BY created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var agents []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.APIKey, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.APIKey = "" // never expose
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

// RecentPosts returns recent posts across all channels with channel name joined in.
type PostWithChannel struct {
	Post
	ChannelName string
}

func (d *DB) RecentPosts(limit int) ([]PostWithChannel, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.db.Query(`
		SELECT p.id, p.channel_id, p.agent_id, p.parent_id, p.content, p.created_at, c.name
		FROM posts p JOIN channels c ON p.channel_id = c.id
		ORDER BY p.created_at DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var posts []PostWithChannel
	for rows.Next() {
		var p PostWithChannel
		var parentID sql.NullInt64
		if err := rows.Scan(&p.ID, &p.ChannelID, &p.AgentID, &parentID, &p.Content, &p.CreatedAt, &p.ChannelName); err != nil {
			return nil, err
		}
		if parentID.Valid {
			v := int(parentID.Int64)
			p.ParentID = &v
		}
		posts = append(posts, p)
	}
	return posts, rows.Err()
}

// --- Rate Limiting ---

// CheckAndIncrementRateLimit atomically checks if the agent is within the allowed rate
// and increments the counter in a single IMMEDIATE transaction. Returns true if allowed.
func (d *DB) CheckAndIncrementRateLimit(agentID, action string, maxPerHour int) (bool, error) {
	var allowed bool
	err := d.WithTx(func(tx Tx) error {
		var count int
		err := tx.QueryRow(
			"SELECT COALESCE(SUM(count), 0) FROM rate_limits WHERE agent_id = ? AND action = ? AND window_start > datetime('now', '-1 hour')",
			agentID, action,
		).Scan(&count)
		if err != nil {
			return err
		}
		if count >= maxPerHour {
			allowed = false
			return nil
		}

		_, err = tx.Exec(`
			INSERT INTO rate_limits (agent_id, action, window_start, count)
			VALUES (?, ?, strftime('%Y-%m-%d %H:%M:00', 'now'), 1)
			ON CONFLICT(agent_id, action, window_start) DO UPDATE SET count = count + 1
		`, agentID, action)
		if err != nil {
			return err
		}
		allowed = true
		return nil
	})
	return allowed, err
}

func (d *DB) CleanupRateLimits() error {
	_, err := d.db.Exec("DELETE FROM rate_limits WHERE window_start < datetime('now', '-2 hours')")
	return err
}
