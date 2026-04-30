package intelligence

import "fmt"

// Error categories for provider errors.
const (
	ErrCategoryDisabled        = "disabled"
	ErrCategoryMissingCreds    = "missing_credentials"
	ErrCategoryRateLimited     = "rate_limited"
	ErrCategoryTimeout         = "timeout"
	ErrCategoryInvalidResponse = "invalid_response"
	ErrCategoryProviderError   = "provider_error"
)

// ProviderError wraps an error with a category for classification.
type ProviderError struct {
	Category string
	Err      error
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("%s: %v", e.Category, e.Err)
}

func (e *ProviderError) Unwrap() error {
	return e.Err
}
