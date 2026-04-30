package intelligence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/panh/wmux/internal/config"

	openai "github.com/openai/openai-go"
	openai_option "github.com/openai/openai-go/option"
	openai_shared "github.com/openai/openai-go/shared"
)

const openaiSystemPrompt = anthropicSystemPrompt

type OpenAIProvider struct {
	client *openai.Client
	model  string
	name   string
}

func NewOpenAIProvider(cfg config.IntelligenceConfig) (*OpenAIProvider, error) {
	if !cfg.Enabled {
		return nil, &ProviderError{Category: ErrCategoryDisabled, Err: errors.New("intelligence disabled")}
	}

	apiKey := os.Getenv(cfg.EnvKeyRef)
	if apiKey == "" {
		return nil, &ProviderError{
			Category: ErrCategoryMissingCreds,
			Err:      fmt.Errorf("env var %q is empty", cfg.EnvKeyRef),
		}
	}

	opts := []openai_option.RequestOption{
		openai_option.WithAPIKey(apiKey),
	}
	if cfg.BaseURL != "" {
		opts = append(opts, openai_option.WithBaseURL(cfg.BaseURL))
	}

	client := openai.NewClient(opts...)
	return &OpenAIProvider{
		client: &client,
		model:  cfg.Model,
		name:   "openai",
	}, nil
}

func (p *OpenAIProvider) Analyze(ctx context.Context, input AnalyzeInput) (Result, error) {
	userMessage := fmt.Sprintf("Current command: [%s]\nTerminal content:\n%s", input.CurrentCommand, input.RawContent)

	resp, err := p.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai_shared.ChatModel(p.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(openaiSystemPrompt),
			openai.UserMessage(userMessage),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONObject: &openai_shared.ResponseFormatJSONObjectParam{},
		},
		MaxTokens: openai.Opt(int64(256)),
	})
	if err != nil {
		return Result{}, p.mapError(err)
	}

	if len(resp.Choices) == 0 {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      errors.New("empty choices in response"),
		}
	}

	content := resp.Choices[0].Message.Content
	if content == "" {
		return Result{}, &ProviderError{
			Category: ErrCategoryInvalidResponse,
			Err:      errors.New("empty message content"),
		}
	}

	return p.parseResponse(content, input)
}

func (p *OpenAIProvider) parseResponse(content string, input AnalyzeInput) (Result, error) {
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

func (p *OpenAIProvider) mapError(err error) *ProviderError {
	if errors.Is(err, context.DeadlineExceeded) {
		return &ProviderError{Category: ErrCategoryTimeout, Err: err}
	}

	errStr := err.Error()
	if strings.Contains(errStr, "context deadline exceeded") || strings.Contains(errStr, "timeout") {
		return &ProviderError{Category: ErrCategoryTimeout, Err: err}
	}

	var apiErr *openai.Error
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

func (p *OpenAIProvider) Name() string {
	return p.name
}
