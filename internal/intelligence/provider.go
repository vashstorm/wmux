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

func NewProvider(cfg config.IntelligenceProviderConfig) (Provider, error) {
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

func ResolveActiveProvider(cfg config.IntelligenceConfig) (config.IntelligenceProviderConfig, error) {
	if !cfg.Enabled {
		return config.IntelligenceProviderConfig{}, &ProviderError{
			Category: ErrCategoryDisabled,
			Err:      fmt.Errorf("intelligence disabled"),
		}
	}
	if len(cfg.Providers) == 0 {
		return config.IntelligenceProviderConfig{}, &ProviderError{
			Category: ErrCategoryMissingCreds,
			Err:      fmt.Errorf("no providers configured"),
		}
	}
	active := cfg.ActiveProvider
	for _, p := range cfg.Providers {
		if p.Name == active {
			return p, nil
		}
	}
	return config.IntelligenceProviderConfig{}, &ProviderError{
		Category: ErrCategoryMissingCreds,
		Err:      fmt.Errorf("active provider %q not found", active),
	}
}

func NewProviderForTesting(cfg FakeProviderConfig) Provider {
	return NewFakeProvider(cfg)
}
