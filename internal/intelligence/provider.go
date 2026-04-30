package intelligence

import (
	"context"
	"fmt"

	"github.com/panh/wmux/internal/config"
)

type Provider interface {
	Analyze(ctx context.Context, input AnalyzeInput) (Result, error)
	Name() string
}

func NewProvider(cfg config.IntelligenceConfig) (Provider, error) {
	switch cfg.Provider {
	case "anthropic":
		return NewAnthropicProvider(cfg)
	case "openai":
		return NewOpenAIProvider(cfg)
	default:
		return nil, &ProviderError{
			Category: ErrCategoryDisabled,
			Err:      fmt.Errorf("unknown provider %q", cfg.Provider),
		}
	}
}

func NewProviderForTesting(cfg FakeProviderConfig) Provider {
	return NewFakeProvider(cfg)
}
