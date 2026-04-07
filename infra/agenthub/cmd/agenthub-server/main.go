package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
	"time"

	"agenthub/internal/db"
	"agenthub/internal/gitrepo"
	"agenthub/internal/server"
)

func main() {
	listenAddr := flag.String("listen", ":8080", "listen address")
	dataDir := flag.String("data", "./data", "data directory (SQLite DB + bare git repo)")
	adminKey := flag.String("admin-key", "", "admin API key (required, or set AGENTHUB_ADMIN_KEY)")
	maxBundleMB := flag.Int("max-bundle-mb", 50, "max bundle upload size in MB")
	maxPushesPerHour := flag.Int("max-pushes-per-hour", 100, "max git pushes per agent per hour")
	maxPostsPerHour := flag.Int("max-posts-per-hour", 100, "max posts per agent per hour")
	flag.Parse()

	// Admin key from flag or env
	key := *adminKey
	if key == "" {
		key = os.Getenv("AGENTHUB_ADMIN_KEY")
	}
	if key == "" {
		log.Fatal("--admin-key or AGENTHUB_ADMIN_KEY is required")
	}

	// Create data directory
	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	// Initialize database
	database, err := db.Open(filepath.Join(*dataDir, "agenthub.db"))
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	if err := database.Migrate(); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	// Initialize bare git repo
	repo, err := gitrepo.Init(filepath.Join(*dataDir, "repo.git"))
	if err != nil {
		log.Fatalf("init git repo: %v", err)
	}

	// Start rate limit cleanup goroutine
	go func() {
		for {
			time.Sleep(30 * time.Minute)
			database.CleanupRateLimits()
		}
	}()

	// Start server
	srv := server.New(database, repo, key, server.Config{
		MaxBundleSize:    int64(*maxBundleMB) * 1024 * 1024,
		MaxPushesPerHour: *maxPushesPerHour,
		MaxPostsPerHour:  *maxPostsPerHour,
		ListenAddr:       *listenAddr,
	})

	log.Fatal(srv.ListenAndServe())
}
