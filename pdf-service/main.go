// Command pdf-service compiles Typst source to PDF.
//
// POST /compile
//   Header: x-api-key: $PDF_SERVICE_API_KEY
//   Body:   {"source": "<raw .typ text>"}          (max 512 KB)
//   200 -> application/pdf
//   401/400/413/422/408/500 -> {"error": "...", "detail": "..."}
//
// GET /healthz -> 200 ok
package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxSourceBytes = 512 * 1024
	maxDetailLen   = 500
	defaultTimeout = 20 * time.Second
	typstBinary    = "typst"
)

type compileRequest struct {
	Source string `json:"source"`
}

func main() {
	apiKey := os.Getenv("PDF_SERVICE_API_KEY")
	if apiKey == "" {
		log.Fatal("PDF_SERVICE_API_KEY must be set")
	}

	timeout := defaultTimeout
	if raw := os.Getenv("COMPILE_TIMEOUT_SECS"); raw != "" {
		var secs int
		if _, err := fmt.Sscanf(raw, "%d", &secs); err == nil && secs > 0 {
			timeout = time.Duration(secs) * time.Second
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /compile", handleCompile(apiKey, timeout))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("pdf-service listening on :%s (compile timeout %s)", port, timeout)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func handleCompile(apiKey string, timeout time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authorized(r, apiKey) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxSourceBytes+(64*1024))
		var req compileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		source := []byte(req.Source)
		if len(source) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source is empty"})
			return
		}
		if len(source) > maxSourceBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "source exceeds size limit"})
			return
		}

		dir, err := os.MkdirTemp("", "typst-job-")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		defer os.RemoveAll(dir)

		inputPath := filepath.Join(dir, "main.typ")
		outputPath := filepath.Join(dir, "out.pdf")
		if err := os.WriteFile(inputPath, source, 0o600); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		cmd := exec.CommandContext(ctx, typstBinary,
			"compile",
			"--ignore-system-fonts",
			inputPath,
			outputPath,
		)
		cmd.Dir = dir

		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			if ctx.Err() != nil || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				writeJSON(w, http.StatusRequestTimeout, map[string]string{"error": "compilation timed out"})
				return
			}
			detail := truncate(stderr.String())
			if strings.TrimSpace(detail) == "" {
				detail = truncate(err.Error())
			}
			log.Printf("compile failed: %s", detail)
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
				"error":  "compilation failed",
				"detail": detail,
			})
			return
		}

		pdf, err := os.Open(outputPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "compiled PDF not found"})
			return
		}
		defer pdf.Close()

		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if _, err := io.Copy(w, pdf); err != nil {
			log.Printf("stream pdf: %v", err)
		}
	}
}

// authorized compares the request key against the configured key in constant time.
func authorized(r *http.Request, apiKey string) bool {
	provided := r.Header.Get("x-api-key")
	if provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(apiKey)) == 1
}

func writeJSON(w http.ResponseWriter, status int, payload map[string]string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func truncate(s string) string {
	if len(s) > maxDetailLen {
		return s[:maxDetailLen]
	}
	return s
}
