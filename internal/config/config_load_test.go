package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCreatesConfigWhenMissing(t *testing.T) {
	dir := t.TempDir()

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	path := filepath.Join(dir, "config.yaml")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("config.yaml not created: %v", err)
	}

	defaults := Defaults()
	if cfg.Target != defaults.Target {
		t.Fatalf("Target = %q, want %q", cfg.Target, defaults.Target)
	}
	if cfg.DataDir != defaults.DataDir {
		t.Fatalf("DataDir = %q, want %q", cfg.DataDir, defaults.DataDir)
	}
	if cfg.UpdateManifestURL != defaults.UpdateManifestURL {
		t.Fatalf("UpdateManifestURL = %q, want %q", cfg.UpdateManifestURL, defaults.UpdateManifestURL)
	}

	cfg2, err := Load(dir)
	if err != nil {
		t.Fatalf("Load second time: %v", err)
	}
	if cfg2.Target != cfg.Target {
		t.Fatalf("reloaded Target = %q, want %q", cfg2.Target, cfg.Target)
	}
}

func TestLoadDefaultsRunAtStartupWhenKeyMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("target: 1.1.1.1\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.RunAtStartup {
		t.Fatal("RunAtStartup should default to true for legacy configs")
	}
}

func TestLoadExistingConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("target: 1.1.1.1\nweb_port: 9090\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Target != "1.1.1.1" {
		t.Fatalf("Target = %q, want 1.1.1.1", cfg.Target)
	}
	if cfg.WebPort != 9090 {
		t.Fatalf("WebPort = %d, want 9090", cfg.WebPort)
	}
}
