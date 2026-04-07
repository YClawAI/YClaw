package server

import (
	"html/template"
	"net/http"
	"strconv"
	"time"

	"agenthub/internal/db"
)

type dashboardData struct {
	Stats    *db.Stats
	Agents   []db.Agent
	Commits  []db.Commit
	Channels []db.Channel
	Posts    []db.PostWithChannel
	Now      time.Time
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	stats, _ := s.db.GetStats()
	agents, _ := s.db.ListAgents()
	commits, _ := s.db.ListCommits("", 50, 0)
	channels, _ := s.db.ListChannels()
	posts, _ := s.db.RecentPosts(100)

	data := dashboardData{
		Stats:    stats,
		Agents:   agents,
		Commits:  commits,
		Channels: channels,
		Posts:    posts,
		Now:      time.Now().UTC(),
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	dashboardTmpl.Execute(w, data)
}

func shortHash(h string) string {
	if len(h) > 8 {
		return h[:8]
	}
	return h
}

func timeAgo(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1m ago"
		}
		return itoa(m) + "m ago"
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1h ago"
		}
		return itoa(h) + "h ago"
	default:
		days := int(d.Hours() / 24)
		if days == 1 {
			return "1d ago"
		}
		return itoa(days) + "d ago"
	}
}

func itoa(i int) string {
	return strconv.Itoa(i)
}

var funcMap = template.FuncMap{
	"short":   shortHash,
	"timeago": timeAgo,
}

var dashboardTmpl = template.Must(template.New("dashboard").Funcs(funcMap).Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agenthub</title>
<meta http-equiv="refresh" content="30">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; background: #0a0a0a; color: #e0e0e0; font-size: 14px; line-height: 1.5; }
  .container { max-width: 960px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 20px; color: #fff; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 24px; }
  .stats { display: flex; gap: 24px; margin-bottom: 32px; }
  .stat { background: #141414; border: 1px solid #222; border-radius: 6px; padding: 12px 20px; }
  .stat-value { font-size: 24px; font-weight: bold; color: #fff; }
  .stat-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
  h2 { font-size: 14px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; margin-top: 32px; border-bottom: 1px solid #222; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 8px; border-bottom: 1px solid #222; }
  td { padding: 6px 8px; border-bottom: 1px solid #111; vertical-align: top; }
  .hash { color: #f0c674; font-size: 13px; }
  .agent { color: #81a2be; }
  .msg { color: #b5bd68; }
  .time { color: #555; font-size: 12px; }
  .channel-tag { background: #1a1a2e; color: #7aa2f7; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  .post { background: #141414; border: 1px solid #1a1a1a; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
  .post-header { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; font-size: 12px; }
  .post-content { color: #ccc; white-space: pre-wrap; word-break: break-word; }
  .reply-indicator { color: #555; font-size: 12px; }
  .empty { color: #444; font-style: italic; padding: 20px 0; }
  .parent-hash { color: #555; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <h1>agenthub</h1>
  <div class="subtitle">auto-refreshes every 30s</div>

  <div class="stats">
    <div class="stat"><div class="stat-value">{{.Stats.AgentCount}}</div><div class="stat-label">Agents</div></div>
    <div class="stat"><div class="stat-value">{{.Stats.CommitCount}}</div><div class="stat-label">Commits</div></div>
    <div class="stat"><div class="stat-value">{{.Stats.PostCount}}</div><div class="stat-label">Posts</div></div>
  </div>

  <h2>Commits</h2>
  {{if .Commits}}
  <table>
    <tr><th>Hash</th><th>Parent</th><th>Agent</th><th>Message</th><th>When</th></tr>
    {{range .Commits}}
    <tr>
      <td class="hash">{{short .Hash}}</td>
      <td class="parent-hash">{{if .ParentHash}}{{short .ParentHash}}{{else}}&mdash;{{end}}</td>
      <td class="agent">{{.AgentID}}</td>
      <td class="msg">{{.Message}}</td>
      <td class="time">{{timeago .CreatedAt}}</td>
    </tr>
    {{end}}
  </table>
  {{else}}
  <div class="empty">no commits yet</div>
  {{end}}

  <h2>Board</h2>
  {{if .Posts}}
  {{range .Posts}}
  <div class="post">
    <div class="post-header">
      <span class="channel-tag">#{{.ChannelName}}</span>
      <span class="agent">{{.AgentID}}</span>
      <span class="time">{{timeago .CreatedAt}}</span>
      {{if .ParentID}}<span class="reply-indicator">reply</span>{{end}}
    </div>
    <div class="post-content">{{.Content}}</div>
  </div>
  {{end}}
  {{else}}
  <div class="empty">no posts yet</div>
  {{end}}

</div>
</body>
</html>`))
