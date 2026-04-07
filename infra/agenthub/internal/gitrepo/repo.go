package gitrepo

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var hashRe = regexp.MustCompile(`^[0-9a-f]{4,64}$`)

// IsValidHash checks that a string looks like a git hash (hex, 4-64 chars).
func IsValidHash(s string) bool {
	return hashRe.MatchString(s)
}

// Repo wraps a bare git repository on disk.
type Repo struct {
	Path string
	mu   sync.Mutex // held during write operations (unbundle)
}

// Init creates or opens a bare git repository.
func Init(path string) (*Repo, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return nil, fmt.Errorf("git binary not found on PATH: %w", err)
	}
	r := &Repo{Path: path}
	// Check if it already exists
	if _, err := os.Stat(filepath.Join(path, "HEAD")); err == nil {
		return r, nil
	}
	// git init --bare creates the directory, but we run it without cmd.Dir
	// since the dir doesn't exist yet
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "init", "--bare", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("git init --bare: %w: %s", err, string(out))
	}
	return r, nil
}

// Unbundle imports a git bundle into the bare repo. Returns all new commit hashes added.
func (r *Repo) Unbundle(bundlePath string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// List heads in the bundle to know what tip refs are coming
	out, err := r.gitOutput("bundle", "list-heads", bundlePath)
	if err != nil {
		return nil, fmt.Errorf("bundle list-heads: %w", err)
	}
	headHashes := parseHeadHashes(out)
	if len(headHashes) == 0 {
		return nil, fmt.Errorf("bundle contains no refs")
	}

	// Snapshot existing refs before unbundle so we can diff
	existingRefs := r.allCommitHashes()

	// Unbundle into the bare repo
	if err := r.git("bundle", "unbundle", bundlePath); err != nil {
		return nil, fmt.Errorf("bundle unbundle: %w", err)
	}

	// Use rev-list to enumerate all commits reachable from heads but not from pre-existing refs
	var excludeArgs []string
	for h := range existingRefs {
		excludeArgs = append(excludeArgs, "^"+h)
	}
	args := append([]string{"rev-list"}, headHashes...)
	args = append(args, excludeArgs...)
	revOut, err := r.gitOutput(args...)
	if err != nil {
		// Fallback: return just the head hashes
		return headHashes, nil
	}

	var newHashes []string
	for _, line := range strings.Split(strings.TrimSpace(revOut), "\n") {
		line = strings.TrimSpace(line)
		if IsValidHash(line) {
			newHashes = append(newHashes, line)
		}
	}
	if len(newHashes) == 0 {
		return headHashes, nil
	}
	return newHashes, nil
}

// allCommitHashes returns a set of all commit hashes currently reachable in the repo.
func (r *Repo) allCommitHashes() map[string]struct{} {
	result := make(map[string]struct{})
	out, err := r.gitOutput("rev-list", "--all")
	if err != nil {
		return result
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if IsValidHash(line) {
			result[line] = struct{}{}
		}
	}
	return result
}

// CreateBundle creates a temporary bundle file containing the given commit and its ancestors.
// The caller is responsible for removing the temp file.
func (r *Repo) CreateBundle(commitHash string) (string, error) {
	if !IsValidHash(commitHash) {
		return "", fmt.Errorf("invalid hash: %s", commitHash)
	}

	// In a bare repo, we need a ref for git bundle to work.
	// Create a temporary ref, bundle it, then clean up.
	tmpRef := "refs/tmp/bundle-" + commitHash[:8]
	if err := r.git("update-ref", tmpRef, commitHash); err != nil {
		return "", fmt.Errorf("create temp ref: %w", err)
	}
	defer r.git("update-ref", "-d", tmpRef)

	tmpFile, err := os.CreateTemp("", "arhub-bundle-*.bundle")
	if err != nil {
		return "", err
	}
	tmpFile.Close()

	if err := r.git("bundle", "create", tmpFile.Name(), tmpRef); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("bundle create: %w", err)
	}
	return tmpFile.Name(), nil
}

// CommitExists checks if a commit hash exists in the repo.
func (r *Repo) CommitExists(hash string) bool {
	if !IsValidHash(hash) {
		return false
	}
	err := r.git("cat-file", "-t", hash)
	return err == nil
}

// GetCommitInfo returns the parent hash(es) and subject of a commit.
func (r *Repo) GetCommitInfo(hash string) (parentHash, message string, err error) {
	if !IsValidHash(hash) {
		return "", "", fmt.Errorf("invalid hash: %s", hash)
	}
	// Use NUL byte separator to avoid ambiguity with empty parent lines
	out, err := r.gitOutput("log", "-1", "--format=%P%x00%s", hash)
	if err != nil {
		return "", "", fmt.Errorf("git log: %w", err)
	}
	out = strings.TrimRight(out, "\n")
	parts := strings.SplitN(out, "\x00", 2)
	if len(parts) >= 1 {
		// First parent only (ignore merge parents for now)
		parents := strings.Fields(parts[0])
		if len(parents) > 0 {
			parentHash = parents[0]
		}
	}
	if len(parts) >= 2 {
		message = parts[1]
	}
	return parentHash, message, nil
}

// Diff returns the diff between two commits.
func (r *Repo) Diff(hashA, hashB string) (string, error) {
	if !IsValidHash(hashA) || !IsValidHash(hashB) {
		return "", fmt.Errorf("invalid hash")
	}
	out, err := r.gitOutput("diff", hashA, hashB)
	if err != nil {
		return "", fmt.Errorf("git diff: %w", err)
	}
	return out, nil
}

// ShowFile returns the contents of a file at a specific commit.
func (r *Repo) ShowFile(hash, path string) (string, error) {
	if !IsValidHash(hash) {
		return "", fmt.Errorf("invalid hash: %s", hash)
	}
	out, err := r.gitOutput("show", fmt.Sprintf("%s:%s", hash, path))
	if err != nil {
		return "", fmt.Errorf("git show: %w", err)
	}
	return out, nil
}

// git runs a git command in the context of the bare repo.
func (r *Repo) git(args ...string) error {
	_, err := r.gitOutput(args...)
	return err
}

func (r *Repo) gitOutput(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	// Pass --git-dir as explicit CLI flag — more reliable than GIT_DIR env var
	// across git versions and subcommands (e.g. bundle unbundle).
	fullArgs := append([]string{"--git-dir=" + r.Path}, args...)
	cmd := exec.CommandContext(ctx, "git", fullArgs...)
	cmd.Dir = r.Path
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%w: %s", err, stderr.String())
	}
	return stdout.String(), nil
}

// parseHeadHashes extracts commit hashes from `git bundle list-heads` output.
// Each line looks like: "<hash> refs/heads/<name>"
func parseHeadHashes(output string) []string {
	var hashes []string
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 1 && IsValidHash(fields[0]) {
			hashes = append(hashes, fields[0])
		}
	}
	return hashes
}
