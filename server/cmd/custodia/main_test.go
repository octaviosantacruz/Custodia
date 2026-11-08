package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "custodia.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExampleConfigLoads(t *testing.T) {
	cfg, err := loadConfig("../../config.example.json")
	if err != nil || cfg.Listen != "127.0.0.1:8090" || cfg.Ozal.Audience != "custodia" {
		t.Fatalf("example = %+v, %v", cfg, err)
	}
}

func TestConfigRefusesUnsafeShapes(t *testing.T) {
	for name, body := range map[string]string{
		"public listener": `{"listen": ":8090", "database_url": "env:X"}`,
		"inline password": `{"listen": "127.0.0.1:8090", "database_url": "postgres://u:p@h/db"}`,
		"unknown field":   `{"listen": "127.0.0.1:8090", "database_url": "env:X", "debug_auth": true}`,
	} {
		if _, err := loadConfig(writeConfig(t, body)); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestSecretReferences(t *testing.T) {
	t.Setenv("CUSTODIA_TEST_REF", "postgres://example")
	if v, err := resolve("env:CUSTODIA_TEST_REF"); err != nil || v != "postgres://example" {
		t.Fatalf("env = %q, %v", v, err)
	}
	path := writeConfig(t, "postgres://from-file\n")
	if v, err := resolve("file:" + path); err != nil || v != "postgres://from-file" {
		t.Fatalf("file = %q, %v", v, err)
	}
	if _, err := resolve("env:CUSTODIA_UNSET_REF"); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("unset env = %v", err)
	}
}
