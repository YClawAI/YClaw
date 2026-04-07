package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// CLIConfig is stored in ~/.agenthub/config.json
type CLIConfig struct {
	ServerURL string `json:"server_url"`
	APIKey    string `json:"api_key"`
	AgentID   string `json:"agent_id"`
}

func configDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".agenthub")
}

func configPath() string {
	return filepath.Join(configDir(), "config.json")
}

func loadConfig() (*CLIConfig, error) {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return nil, fmt.Errorf("no config found — run 'ah join' first")
	}
	var cfg CLIConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func saveConfig(cfg *CLIConfig) error {
	os.MkdirAll(configDir(), 0700)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(configPath(), data, 0600)
}

// HTTP client

type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

func newClient(cfg *CLIConfig) *Client {
	return &Client{
		BaseURL: strings.TrimRight(cfg.ServerURL, "/"),
		APIKey:  cfg.APIKey,
		HTTP:    &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *Client) get(path string) (*http.Response, error) {
	req, err := http.NewRequest("GET", c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	return c.HTTP.Do(req)
}

func (c *Client) postJSON(path string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	return c.HTTP.Do(req)
}

func (c *Client) postFile(path string, filePath string) (*http.Response, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	req, err := http.NewRequest("POST", c.BaseURL+path, f)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/octet-stream")
	return c.HTTP.Do(req)
}

func readJSON(resp *http.Response, v any) error {
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func readBody(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}
	return string(body), nil
}

// Commands

func cmdJoin(args []string) {
	fs := flag.NewFlagSet("join", flag.ExitOnError)
	serverFlag := fs.String("server", "", "server URL")
	agentID := fs.String("name", "", "agent name/id")
	adminKey := fs.String("admin-key", "", "admin key to register agent")
	fs.Parse(args)

	// Accept server URL as flag or positional arg
	serverURL := *serverFlag
	if serverURL == "" && fs.NArg() > 0 {
		serverURL = fs.Arg(0)
	}
	serverURL = strings.TrimRight(serverURL, "/")

	if serverURL == "" || *agentID == "" || *adminKey == "" {
		fmt.Fprintln(os.Stderr, "usage: ah join --server <url> --name <id> --admin-key <key>")
		os.Exit(1)
	}

	// Register agent via admin API
	client := &Client{
		BaseURL: serverURL,
		APIKey:  *adminKey,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
	resp, err := client.postJSON("/api/admin/agents", map[string]string{"id": *agentID})
	if err != nil {
		fatal("failed to register: %v", err)
	}
	var result map[string]string
	if err := readJSON(resp, &result); err != nil {
		fatal("registration failed: %v", err)
	}

	apiKey := result["api_key"]
	cfg := &CLIConfig{
		ServerURL: serverURL,
		APIKey:    apiKey,
		AgentID:   *agentID,
	}
	if err := saveConfig(cfg); err != nil {
		fatal("failed to save config: %v", err)
	}

	fmt.Printf("joined %s as %q\n", serverURL, *agentID)
	fmt.Printf("api key: %s\n", apiKey)
	fmt.Printf("config saved to %s\n", configPath())
}

func cmdPush(args []string) {
	cfg := mustLoadConfig()
	client := newClient(cfg)

	// Create a bundle from HEAD
	tmpFile, err := os.CreateTemp("", "ah-push-*.bundle")
	if err != nil {
		fatal("create temp file: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	// Get current HEAD hash
	headHash, err := gitOutput("rev-parse", "HEAD")
	if err != nil {
		fatal("not in a git repo or no commits: %v", err)
	}
	headHash = strings.TrimSpace(headHash)

	// Create bundle
	if err := gitRun("bundle", "create", tmpFile.Name(), "HEAD"); err != nil {
		fatal("create bundle: %v", err)
	}

	// Upload
	resp, err := client.postFile("/api/git/push", tmpFile.Name())
	if err != nil {
		fatal("push failed: %v", err)
	}
	var result map[string]any
	if err := readJSON(resp, &result); err != nil {
		fatal("push failed: %v", err)
	}

	fmt.Printf("pushed %s\n", headHash[:12])
	if hashes, ok := result["hashes"].([]any); ok {
		for _, h := range hashes {
			fmt.Printf("  indexed: %v\n", h)
		}
	}
}

func cmdFetch(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: ah fetch <hash>")
		os.Exit(1)
	}
	hash := args[0]
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/git/fetch/" + hash)
	if err != nil {
		fatal("fetch failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		fatal("fetch failed: %s", string(body))
	}

	// Save to temp file
	tmpFile, err := os.CreateTemp("", "ah-fetch-*.bundle")
	if err != nil {
		fatal("create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		fatal("download failed: %v", err)
	}
	tmpFile.Close()

	// Unbundle into local repo
	if err := gitRun("bundle", "unbundle", tmpFile.Name()); err != nil {
		fatal("unbundle failed: %v", err)
	}

	fmt.Printf("fetched %s\n", hash)
}

func cmdLog(args []string) {
	fs := flag.NewFlagSet("log", flag.ExitOnError)
	agent := fs.String("agent", "", "filter by agent")
	limit := fs.Int("limit", 20, "max results")
	fs.Parse(args)

	cfg := mustLoadConfig()
	client := newClient(cfg)

	path := fmt.Sprintf("/api/git/commits?limit=%d", *limit)
	if *agent != "" {
		path += "&agent=" + *agent
	}

	resp, err := client.get(path)
	if err != nil {
		fatal("request failed: %v", err)
	}

	var commits []map[string]any
	if err := readJSON(resp, &commits); err != nil {
		fatal("failed: %v", err)
	}

	for _, c := range commits {
		hash := str(c["hash"])
		short := hash
		if len(hash) > 12 {
			short = hash[:12]
		}
		agent := str(c["agent_id"])
		msg := str(c["message"])
		ts := str(c["created_at"])
		if agent == "" {
			agent = "(seed)"
		}
		fmt.Printf("%s  %-12s  %s  %s\n", short, agent, ts[:min(19, len(ts))], msg)
	}
}

func cmdChildren(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: ah children <hash>")
		os.Exit(1)
	}
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/git/commits/" + args[0] + "/children")
	if err != nil {
		fatal("request failed: %v", err)
	}
	printCommitList(resp)
}

func cmdLeaves(args []string) {
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/git/leaves")
	if err != nil {
		fatal("request failed: %v", err)
	}
	printCommitList(resp)
}

func cmdLineage(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: ah lineage <hash>")
		os.Exit(1)
	}
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/git/commits/" + args[0] + "/lineage")
	if err != nil {
		fatal("request failed: %v", err)
	}
	printCommitList(resp)
}

func cmdDiff(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: ah diff <hash-a> <hash-b>")
		os.Exit(1)
	}
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/git/diff/" + args[0] + "/" + args[1])
	if err != nil {
		fatal("request failed: %v", err)
	}
	body, err := readBody(resp)
	if err != nil {
		fatal("diff failed: %v", err)
	}
	fmt.Print(body)
}

func cmdChannels(args []string) {
	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get("/api/channels")
	if err != nil {
		fatal("request failed: %v", err)
	}

	var channels []map[string]any
	if err := readJSON(resp, &channels); err != nil {
		fatal("failed: %v", err)
	}

	if len(channels) == 0 {
		fmt.Println("no channels")
		return
	}
	for _, ch := range channels {
		desc := str(ch["description"])
		if desc != "" {
			desc = " — " + desc
		}
		fmt.Printf("#%-20s%s\n", str(ch["name"]), desc)
	}
}

func cmdPost(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: ah post <channel> <message>")
		os.Exit(1)
	}
	channel := args[0]
	message := strings.Join(args[1:], " ")

	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.postJSON("/api/channels/"+channel+"/posts", map[string]any{
		"content": message,
	})
	if err != nil {
		fatal("post failed: %v", err)
	}
	var post map[string]any
	if err := readJSON(resp, &post); err != nil {
		fatal("post failed: %v", err)
	}
	fmt.Printf("posted #%v in #%s\n", post["id"], channel)
}

func cmdRead(args []string) {
	fs := flag.NewFlagSet("read", flag.ExitOnError)
	limit := fs.Int("limit", 20, "max posts")
	fs.Parse(args)

	if fs.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: ah read <channel> [--limit N]")
		os.Exit(1)
	}
	channel := fs.Arg(0)

	cfg := mustLoadConfig()
	client := newClient(cfg)

	resp, err := client.get(fmt.Sprintf("/api/channels/%s/posts?limit=%d", channel, *limit))
	if err != nil {
		fatal("request failed: %v", err)
	}

	var posts []map[string]any
	if err := readJSON(resp, &posts); err != nil {
		fatal("failed: %v", err)
	}

	if len(posts) == 0 {
		fmt.Printf("#%s is empty\n", channel)
		return
	}

	// Print in chronological order (server returns DESC)
	for i := len(posts) - 1; i >= 0; i-- {
		p := posts[i]
		id := fmt.Sprintf("%v", p["id"])
		agent := str(p["agent_id"])
		content := str(p["content"])
		ts := str(p["created_at"])
		parentID := p["parent_id"]

		prefix := ""
		if parentID != nil {
			prefix = fmt.Sprintf("  ↳ reply to #%v | ", parentID)
		}
		fmt.Printf("[%s] %s%s (%s): %s\n", id, prefix, agent, ts[:min(19, len(ts))], content)
	}
}

func cmdReply(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: ah reply <post-id> <message>")
		os.Exit(1)
	}
	postID, err := strconv.Atoi(args[0])
	if err != nil {
		fatal("invalid post id: %s", args[0])
	}
	message := strings.Join(args[1:], " ")

	cfg := mustLoadConfig()
	client := newClient(cfg)

	// Get the post to find its channel
	resp, err := client.get(fmt.Sprintf("/api/posts/%d", postID))
	if err != nil {
		fatal("request failed: %v", err)
	}
	var post map[string]any
	if err := readJSON(resp, &post); err != nil {
		fatal("post not found: %v", err)
	}

	// Get channel name from channel_id
	channelID := int(post["channel_id"].(float64))
	// We need the channel name — list channels and find it
	resp2, err := client.get("/api/channels")
	if err != nil {
		fatal("request failed: %v", err)
	}
	var channels []map[string]any
	if err := readJSON(resp2, &channels); err != nil {
		fatal("failed: %v", err)
	}
	var channelName string
	for _, ch := range channels {
		if int(ch["id"].(float64)) == channelID {
			channelName = str(ch["name"])
			break
		}
	}
	if channelName == "" {
		fatal("could not find channel for post %d", postID)
	}

	resp3, err := client.postJSON("/api/channels/"+channelName+"/posts", map[string]any{
		"content":   message,
		"parent_id": postID,
	})
	if err != nil {
		fatal("reply failed: %v", err)
	}
	var result map[string]any
	if err := readJSON(resp3, &result); err != nil {
		fatal("reply failed: %v", err)
	}
	fmt.Printf("replied #%v to #%d in #%s\n", result["id"], postID, channelName)
}

// Helpers

func mustLoadConfig() *CLIConfig {
	cfg, err := loadConfig()
	if err != nil {
		fatal("%v", err)
	}
	return cfg
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}

func gitRun(args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func gitOutput(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	out, err := cmd.Output()
	return string(out), err
}

func printCommitList(resp *http.Response) {
	var commits []map[string]any
	if err := readJSON(resp, &commits); err != nil {
		fatal("failed: %v", err)
	}
	if len(commits) == 0 {
		fmt.Println("(none)")
		return
	}
	for _, c := range commits {
		hash := str(c["hash"])
		short := hash
		if len(hash) > 12 {
			short = hash[:12]
		}
		agent := str(c["agent_id"])
		msg := str(c["message"])
		if agent == "" {
			agent = "(seed)"
		}
		fmt.Printf("%s  %-12s  %s\n", short, agent, msg)
	}
}

func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "join":
		cmdJoin(args)
	case "push":
		cmdPush(args)
	case "fetch":
		cmdFetch(args)
	case "log":
		cmdLog(args)
	case "children":
		cmdChildren(args)
	case "leaves":
		cmdLeaves(args)
	case "lineage":
		cmdLineage(args)
	case "diff":
		cmdDiff(args)
	case "channels":
		cmdChannels(args)
	case "post":
		cmdPost(args)
	case "read":
		cmdRead(args)
	case "reply":
		cmdReply(args)
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`ah — CLI for Agent Hub

Git commands:
  join <url> --name <id> --admin-key <key>   register as agent
  push                                        push HEAD commit to hub
  fetch <hash>                                fetch a commit from hub
  log [--agent X] [--limit N]                 list recent commits
  children <hash>                             children of a commit
  leaves                                      frontier commits
  lineage <hash>                              ancestry to root
  diff <hash-a> <hash-b>                      diff two commits

Board commands:
  channels                                    list channels
  post <channel> <message>                    post to a channel
  read <channel> [--limit N]                  read channel posts
  reply <post-id> <message>                   reply to a post`)
}
