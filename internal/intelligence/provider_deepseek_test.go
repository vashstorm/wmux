package intelligence

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/panh/wmux/internal/config"

	openai "github.com/openai/openai-go"
	openai_option "github.com/openai/openai-go/option"
)

func TestDeepseekProviderRealOutput(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found, skipping real deepseek test: %v", err)
		}
	}

	cfg := store.Snapshot()
	if !cfg.Intelligence.Enabled {
		t.Skip("intelligence not enabled in config")
	}

	var deepseekCfg config.IntelligenceProviderConfig
	found := false
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == cfg.Intelligence.ActiveProvider {
			deepseekCfg = p
			found = true
			break
		}
	}
	if !found {
		t.Skipf("active provider %q not found in config", cfg.Intelligence.ActiveProvider)
	}

	log.Printf("Testing provider: name=%s provider=%s model=%s baseURL=%s",
		deepseekCfg.Name, deepseekCfg.Provider, deepseekCfg.Model, deepseekCfg.BaseURL)

	provider, err := NewProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	log.Printf("Provider created successfully: %s", provider.Name())

	testInput := AnalyzeInput{
		PaneID:         "%1",
		SessionName:    "test-session",
		WindowID:       "test-window",
		CurrentCommand: "vim",
		RawContent:     "NVIM v0.10.0\n~\n~\n~\n~\n~\n~\n~\n~\n[No Name] - 0 lines",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	log.Printf("Calling Analyze with input: PaneID=%s CurrentCommand=%s",
		testInput.PaneID, testInput.CurrentCommand)

	result, err := provider.Analyze(ctx, testInput)
	if err != nil {
		log.Printf("Analyze error: %v", err)
		log.Printf("This may indicate an invalid model name or API issue.")
		log.Printf("Deepseek valid models include: deepseek-chat, deepseek-reasoner")
		t.Fatalf("Analyze failed: %v", err)
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n=== Deepseek Provider Output ===\n%s\n\n", string(resultJSON))

	log.Printf("Analyze succeeded: App=%s Status=%s Confidence=%.2f Summary=%q",
		result.App, result.Status, result.Confidence, result.Summary)
}

func TestDeepseekProviderWithZshOutput(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found, skipping real deepseek test: %v", err)
		}
	}

	cfg := store.Snapshot()
	if !cfg.Intelligence.Enabled {
		t.Skip("intelligence not enabled in config")
	}

	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == cfg.Intelligence.ActiveProvider {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skipf("active provider %q not found", cfg.Intelligence.ActiveProvider)
	}

	provider, err := NewProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	testInput := AnalyzeInput{
		PaneID:         "%2",
		SessionName:    "dev",
		WindowID:       "build",
		CurrentCommand: "npm run build",
		RawContent:     "> wmux@0.1.0 build\n> tsc && vite build\n\nvite v5.0.0 building for production...\ntransforming (42) src/main.tsx",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := provider.Analyze(ctx, testInput)
	if err != nil {
		t.Fatalf("Analyze failed: %v", err)
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n=== Deepseek Provider Output (Build Command) ===\n%s\n\n", string(resultJSON))
}

func TestDeepseekProviderErrorHandling(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found, skipping real deepseek test: %v", err)
		}
	}

	cfg := store.Snapshot()
	if !cfg.Intelligence.Enabled {
		t.Skip("intelligence not enabled in config")
	}

	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == cfg.Intelligence.ActiveProvider {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skipf("active provider %q not found", cfg.Intelligence.ActiveProvider)
	}

	provider, err := NewProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	testInput := AnalyzeInput{
		PaneID:         "%3",
		SessionName:    "test",
		WindowID:       "w1",
		CurrentCommand: "",
		RawContent:     "",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := provider.Analyze(ctx, testInput)
	if err != nil {
		log.Printf("Analyze returned error (may be expected): %v", err)
		return
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n=== Deepseek Provider Output (Empty Input) ===\n%s\n\n", string(resultJSON))
}

func TestDeepseekRawResponse(t *testing.T) {
	if os.Getenv("DEEPSEEK_DUMP_RAW") != "1" {
		t.Skip("set DEEPSEEK_DUMP_RAW=1 to dump raw API responses")
	}

	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == cfg.Intelligence.ActiveProvider {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("active provider not found")
	}

	provider, err := NewOpenAIProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	_ = provider

	testInput := AnalyzeInput{
		PaneID:         "%1",
		SessionName:    "test",
		CurrentCommand: "git diff",
		RawContent:     "diff --git a/main.go b/main.go\nindex 123..456 100644\n--- a/main.go\n+++ b/main.go\n@@ -1,5 +1,5 @@\n package main\n \n func main() {\n-\tfmt.Println(\"hello\")\n+\tfmt.Println(\"world\")\n }",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := provider.Analyze(ctx, testInput)
	if err != nil {
		t.Fatalf("Analyze failed: %v", err)
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n%s\n", string(resultJSON))
}

func TestDeepseekWithCorrectedModel(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	if !cfg.Intelligence.Enabled {
		t.Skip("intelligence not enabled in config")
	}

	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == cfg.Intelligence.ActiveProvider {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("active provider not found")
	}

	originalModel := deepseekCfg.Model
	modelsToTry := []string{originalModel, "deepseek-chat", "deepseek-reasoner"}

	for _, model := range modelsToTry {
		deepseekCfg.Model = model
		log.Printf("Trying model: %s", model)

		provider, err := NewOpenAIProvider(deepseekCfg)
		if err != nil {
			log.Printf("Failed to create provider with model %s: %v", model, err)
			continue
		}

		testInput := AnalyzeInput{
			PaneID:         "%1",
			SessionName:    "test-session",
			WindowID:       "test-window",
			CurrentCommand: "vim",
			RawContent:     "NVIM v0.10.0\n~\n~\n~\n~\n~\n~\n~\n~\n[No Name] - 0 lines",
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)

		result, err := provider.Analyze(ctx, testInput)
		cancel()

		if err != nil {
			log.Printf("Model %s failed: %v", model, err)
			continue
		}

		resultJSON, _ := json.MarshalIndent(result, "", "  ")
		fmt.Printf("\n=== Deepseek Provider Output (model=%s) ===\n%s\n\n", model, string(resultJSON))
		return
	}

	t.Fatalf("All model names failed: %v", modelsToTry)
}

func TestDeepseekV4FlashViaSDK(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found in config")
	}

	deepseekCfg.Model = "deepseek-v4-flash"

	log.Printf("Testing deepseek-v4-flash via openai-go SDK")

	provider, err := NewOpenAIProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	testInput := AnalyzeInput{
		PaneID:         "%1",
		SessionName:    "test-session",
		WindowID:       "test-window",
		CurrentCommand: "vim",
		RawContent:     "NVIM v0.10.0",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := provider.Analyze(ctx, testInput)
	if err != nil {
		log.Printf("SDK call failed: %v", err)
		log.Printf("This confirms the issue is with openai-go SDK, not the API")
		t.Fatalf("SDK call failed: %v", err)
	}

	resultJSON, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n=== Deepseek v4-flash via SDK ===\n%s\n\n", string(resultJSON))
}

func TestDeepseekV4FlashViaSDKWithoutJSONMode(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found in config")
	}

	deepseekCfg.Model = "deepseek-v4-flash"

	log.Printf("Testing deepseek-v4-flash via SDK WITHOUT JSON mode")

	provider, err := NewOpenAIProvider(deepseekCfg)
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	userMessage := "Current command: [vim]\nTerminal content:\nNVIM v0.10.0"

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModel(deepseekCfg.Model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You analyze terminal pane content. Return a JSON object with fields: application, status, summary, confidence, reason."),
			openai.UserMessage(userMessage),
		},
		MaxTokens: openai.Opt(int64(256)),
	}

	paramsJSON, _ := json.MarshalIndent(params, "", "  ")
	fmt.Printf("SDK request body:\n%s\n\n", string(paramsJSON))

	resp, err := provider.client.Chat.Completions.New(ctx, params)
	if err != nil {
		log.Printf("SDK call without JSON mode failed: %v", err)
		t.Fatalf("SDK call failed: %v", err)
	}

	if len(resp.Choices) == 0 {
		t.Fatal("No choices in response")
	}

	content := resp.Choices[0].Message.Content
	fmt.Printf("Content (no JSON mode): %q\n", content)
	fmt.Printf("Content length: %d\n", len(content))
}

func TestDeepseekV4FlashSDKParseComparison(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found")
	}

	body := map[string]any{
		"model": "deepseek-v4-flash",
		"messages": []map[string]string{
			{"role": "system", "content": "Return JSON with fields: application, status, summary, confidence, reason."},
			{"role": "user", "content": "Current command: [vim]\nTerminal content:\nNVIM v0.10.0"},
		},
		"max_tokens": 256,
		"stream":     false,
	}

	bodyJSON, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(context.Background(), "POST", deepseekCfg.BaseURL+"/chat/completions", bytes.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deepseekCfg.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	fmt.Printf("=== Standard json.Unmarshal ===\n")
	var stdResp openai.ChatCompletion
	stdErr := json.Unmarshal(respBody, &stdResp)
	if stdErr != nil {
		log.Printf("Standard unmarshal failed: %v", stdErr)
	} else {
		log.Printf("Standard unmarshal content length: %d", len(stdResp.Choices[0].Message.Content))
	}
}

func TestDeepseekV4FlashSDKIntercept(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found")
	}

	deepseekCfg.Model = "deepseek-v4-flash"

	log.Printf("Testing with intercepted HTTP response")

	var capturedBody []byte
	customClient := &http.Client{
		Transport: &interceptorTransport{
			wrapped: http.DefaultTransport,
			onResponse: func(resp *http.Response) {
				body, _ := io.ReadAll(resp.Body)
				resp.Body = io.NopCloser(bytes.NewReader(body))
				capturedBody = body
				fmt.Printf("Intercepted HTTP response (%d bytes):\n%s\n\n", len(body), string(body))
			},
		},
	}

	apiKey := deepseekCfg.APIKey
	baseURL := deepseekCfg.BaseURL
	client := openai.NewClient(
		openai_option.WithAPIKey(apiKey),
		openai_option.WithBaseURL(baseURL),
		openai_option.WithHTTPClient(customClient),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModel(deepseekCfg.Model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("Return JSON with fields: application, status, summary, confidence, reason."),
			openai.UserMessage("Current command: [vim]\nTerminal content:\nNVIM v0.10.0"),
		},
		MaxTokens: openai.Opt(int64(256)),
	})
	if err != nil {
		log.Printf("SDK call failed: %v", err)
		t.Fatalf("SDK call failed: %v", err)
	}

	fmt.Printf("SDK parsed content: %q\n", resp.Choices[0].Message.Content)
	fmt.Printf("SDK parsed content length: %d\n", len(resp.Choices[0].Message.Content))
	fmt.Printf("Captured raw response content length: %d\n", len(capturedBody))

	if len(capturedBody) > 0 {
		var stdResp openai.ChatCompletion
		stdErr := json.Unmarshal(capturedBody, &stdResp)
		if stdErr != nil {
			log.Printf("Standard unmarshal of captured body failed: %v", stdErr)
		} else {
			log.Printf("Standard unmarshal of captured body content length: %d", len(stdResp.Choices[0].Message.Content))
		}
	}
}

func TestDeepseekV4FlashWithThinkingDisabled(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found")
	}

	body := map[string]any{
		"model": "deepseek-v4-flash",
		"messages": []map[string]string{
			{"role": "system", "content": "Return JSON with fields: application, status, summary, confidence, reason."},
			{"role": "user", "content": "Current command: [vim]\nTerminal content:\nNVIM v0.10.0"},
		},
		"max_tokens": 256,
		"stream":     false,
		"thinking":   map[string]string{"type": "disabled"},
	}

	bodyJSON, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(context.Background(), "POST", deepseekCfg.BaseURL+"/chat/completions", bytes.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deepseekCfg.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Printf("Response with thinking disabled:\n%s\n\n", string(respBody))

	var apiResp map[string]any
	json.Unmarshal(respBody, &apiResp)
	choices := apiResp["choices"].([]any)
	message := choices[0].(map[string]any)["message"].(map[string]any)
	content := message["content"].(string)
	fmt.Printf("Content with thinking disabled: %q\n", content)
	fmt.Printf("Content length: %d\n", len(content))
}

type interceptorTransport struct {
	wrapped    http.RoundTripper
	onResponse func(*http.Response)
}

func (t *interceptorTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := t.wrapped.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if t.onResponse != nil {
		t.onResponse(resp)
	}
	return resp, nil
}

func TestDeepseekV4FlashRawResponseParse(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found")
	}

	body := map[string]any{
		"model": "deepseek-v4-flash",
		"messages": []map[string]string{
			{"role": "system", "content": "Return JSON with fields: application, status, summary, confidence, reason."},
			{"role": "user", "content": "Current command: [vim]\nTerminal content:\nNVIM v0.10.0"},
		},
		"max_tokens": 256,
		"stream":     false,
	}

	bodyJSON, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(context.Background(), "POST", deepseekCfg.BaseURL+"/chat/completions", bytes.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deepseekCfg.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Printf("Raw HTTP response (%d bytes):\n%s\n\n", len(respBody), string(respBody))

	var apiResp openai.ChatCompletion
	err = json.Unmarshal(respBody, &apiResp)
	if err != nil {
		log.Printf("Failed to unmarshal into SDK struct: %v", err)
		log.Printf("This indicates the SDK cannot parse deepseek-v4-flash responses")
		t.Fatalf("SDK unmarshal failed: %v", err)
	}

	if len(apiResp.Choices) == 0 {
		t.Fatal("No choices")
	}

	content := apiResp.Choices[0].Message.Content
	fmt.Printf("SDK parsed content: %q\n", content)
	fmt.Printf("SDK parsed content length: %d\n", len(content))
}

func TestDeepseekV4FlashDirectHTTP(t *testing.T) {
	store, err := config.Load("../../config.jsonc")
	if err != nil {
		store, err = config.Load("config.jsonc")
		if err != nil {
			t.Skipf("config.jsonc not found: %v", err)
		}
	}

	cfg := store.Snapshot()
	var deepseekCfg config.IntelligenceProviderConfig
	for _, p := range cfg.Intelligence.Providers {
		if p.Name == "deepseek" {
			deepseekCfg = p
			break
		}
	}
	if deepseekCfg.Name == "" {
		t.Skip("deepseek provider not found in config")
	}

	deepseekCfg.Model = "deepseek-v4-flash"
	body := map[string]any{
		"model": "deepseek-v4-flash",
		"messages": []map[string]string{
			{"role": "system", "content": "You analyze terminal pane content. Return a JSON object with fields: application, status, summary, confidence, reason."},
			{"role": "user", "content": "Current command: [vim]\nTerminal content:\nNVIM v0.10.0"},
		},
		"response_format": map[string]string{"type": "json_object"},
		"max_tokens":    256,
		"stream":        false,
	}

	bodyJSON, _ := json.Marshal(body)
	fmt.Printf("Request body:\n%s\n\n", string(bodyJSON))

	req, _ := http.NewRequestWithContext(context.Background(), "POST", deepseekCfg.BaseURL+"/chat/completions", bytes.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+deepseekCfg.APIKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("HTTP request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Printf("HTTP %d Response:\n%s\n\n", resp.StatusCode, string(respBody))

	var apiResp map[string]any
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	choices, ok := apiResp["choices"].([]any)
	if !ok || len(choices) == 0 {
		t.Fatal("No choices in response")
	}

	choice := choices[0].(map[string]any)
	message := choice["message"].(map[string]any)
	content := message["content"].(string)

	fmt.Printf("Content from deepseek-v4-flash:\n%s\n", content)
}
