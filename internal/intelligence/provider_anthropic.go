package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/panh/wmux/internal/config"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropic_option "github.com/anthropics/anthropic-sdk-go/option"
)

const anthropicSystemPrompt = `You analyze terminal pane content and classify what application is running and its status.
Return a JSON object with these exact fields:
- application: one of "claude", "codex", "opencode", "zsh", "unknown"
- status: one of "dead_loop", "blocked", "waiting", "running", "none"
- summary: one sentence max 120 characters describing what the pane is doing
- confidence: float 0.0-1.0 for your confidence
- reason: optional string max 240 characters explaining your reasoning

Rules:
- "claude" is the Claude CLI tool by Anthropic
- "codex" is the OpenAI Codex CLI tool
- "opencode" is the OpenCode CLI tool
- "zsh" is a zsh shell (when none of the above apply)
- "unknown" if you cannot determine the application
- "dead_loop" if the pane appears to be repeating without progress
- "blocked" if blocked by an error or permission issue
- "waiting" if waiting for user input or external resource
- "running" if actively executing or processing
- "none" if idle or no clear state`

type llmResponse struct {
	Application string  `json:"application"`
	Status      string  `json:"status"`
	Summary     string  `json:"summary"`
	Confidence  float64 `json:"confidence"`
	Reason      string  `json:"reason"`
}

type AnthropicProvider struct {
	client *anthropic.Client
	model  string
	name   string
}

func NewAnthropicProvider(cfg config.IntelligenceConfig) (*AnthropicProvider, error) {
	if !cfg.Enabled {
		return nil, &ProviderError{Category: ErrCategoryDisabled, Err: errors.New("intelligence disabled")}
	}

	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, &ProviderError{
			Category: ErrCategoryMissingCreds,
			Err:      errors.New("api key is empty"),
		}
	}

	opts := []anthropic_option.RequestOption{
		anthropic_option.WithAPIKey(apiKey),
	}
	if cfg.BaseURL != "" {
		opts = append(opts, anthropic_option.WithBaseURL(cfg.BaseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicProvider{
		client: &client,
		model:  cfg.Model,
		name:   "anthropic",
	}, nil
}

func (p *AnthropicProvider) Analyze(ctx context.Context, input AnalyzeInput) (Result, error) {
	userMessage := fmt.Sprintf("Current command: [%s]\nTerminal content:\n%s", input.CurrentCommand, input.RawContent)

	msg, err := p.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(p.model),
		MaxTokens: 256,
		System: []anthropic.TextBlockParam{{
			Text: anthropicSystemPrompt,
		}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userMessage)),
		},
	})
	if err != nil {
		return Result{}, p.mapError(err)
	}

	if len(msg.Content) == 0 {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      errors.New("empty response from provider"),
		}
	}

	textBlock := msg.Content[0].AsText()
	if textBlock.Text == "" {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      errors.New("empty text block in response"),
		}
	}

	return p.parseResponse(textBlock.Text, input)
}

func (p *AnthropicProvider) parseResponse(content string, input AnalyzeInput) (Result, error) {
	var resp llmResponse
	if err := json.Unmarshal([]byte(content), &resp); err != nil {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      fmt.Errorf("failed to parse JSON: %w", err),
		}
	}

	app := NormalizeApplication(resp.Application)
	status := NormalizeStatus(resp.Status)

	if app == AppUnknown && resp.Application != "" && resp.Application != "unknown" {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      fmt.Errorf("invalid application value: %q", resp.Application),
		}
	}

	if status == StatusNone && resp.Status != "" && resp.Status != "none" {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      fmt.Errorf("invalid status value: %q", resp.Status),
		}
	}

	summary := resp.Summary
	if len(summary) > 120 {
		summary = summary[:120]
	}

	reason := resp.Reason
	if len(reason) > 240 {
		reason = reason[:240]
	}

	confidence := resp.Confidence
	if confidence <= 0 {
		confidence = 0.5
	}

	return Result{
		PaneID:      input.PaneID,
		SessionName: input.SessionName,
		WindowID:    input.WindowID,
		App:         app,
		Status:      status,
		Summary:     summary,
		Confidence:  confidence,
		Reason:      reason,
		Source:      p.name,
	}, nil
}

func (p *AnthropicProvider) mapError(err error) *ProviderError {
	if errors.Is(err, context.DeadlineExceeded) {
		return &ProviderError{Category: ErrCategoryTimeout, Err: err}
	}

	errStr := err.Error()
	if strings.Contains(errStr, "context deadline exceeded") || strings.Contains(errStr, "timeout") {
		return &ProviderError{Category: ErrCategoryTimeout, Err: err}
	}

	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusTooManyRequests:
			return &ProviderError{Category: ErrCategoryRateLimited, Err: err}
		case http.StatusInternalServerError, http.StatusServiceUnavailable:
			return &ProviderError{Category: ErrCategoryProviderError, Err: err}
		}
	}

	return &ProviderError{Category: ErrCategoryProviderError, Err: err}
}

func (p *AnthropicProvider) Name() string {
	return p.name
}
