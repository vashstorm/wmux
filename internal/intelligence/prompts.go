package intelligence

import "fmt"

type ProviderKind string

const (
	ProviderAnthropic ProviderKind = "anthropic"
	ProviderOpenAI    ProviderKind = "openai"
)

type PromptSet struct {
	SystemByProvider   map[ProviderKind]string
	UserPromptTemplate string
}

const defaultSystemPrompt = `You analyze terminal pane content and classify what application is running and its status.

CRITICAL: Respond in Chinese. All text fields must be in Chinese.

Return a JSON object with these exact fields:
- application: one of "claude", "codex", "opencode", "zsh", "unknown"
- status: one of "dead_loop", "blocked", "waiting_confirm", "waiting_idle", "running", "none"
- summary: one sentence, max 120 characters, in Chinese, describing what the pane is doing
- confidence: float 0.0-1.0
- reason: optional, max 240 characters, in Chinese

Status rules (follow strictly). These statuses describe the LLM state inside an AI CLI tool:
- "dead_loop": the LLM in the AI CLI is stuck repeating the same content or action without making progress
- "blocked": the AI CLI encountered an error (API error, permission denied, network failure, etc.)
- "waiting_confirm": the LLM has proposed a plan/action and is waiting for user confirmation or decision (e.g., "Do you want me to proceed?", "Confirm file deletion", tool use approval)
- "waiting_idle": the AI CLI is idle with a blinking prompt after task completion, or just started fresh session waiting for first input
- "running": the LLM is working normally and actively generating output
- "none": the pane is not running an AI CLI, or the shell is idle at prompt with no command running. This is the default for zsh/bash showing only a prompt.

Application identification rules (follow strictly):
- "claude": Claude CLI by Anthropic. Look for "Claude" branding, Anthropic references, or Claude-specific UI elements.
- "codex": OpenAI Codex CLI. Look for "Codex" branding or OpenAI-specific elements.
- "opencode": OpenCode CLI (ocx). CRITICAL IDENTIFIERS: The command running is "ocx", the pane title is "OpenCode", and the interface shows: "Sisyphus" agent name, "Kimi" model references, "Ask anything..." prompt text, "tab agents" or "ctrl+p commands" at bottom, block-style ASCII art logo (▀▀▀▀ patterns), and "OpenCode Go" text. If you see ANY of these identifiers, application MUST be "opencode".
- "zsh": zsh shell (default when none of above). Look for standard shell prompts with directory paths, git status, and command history.
- "unknown": cannot determine

CRITICAL: When CurrentCommand is "ocx" or pane title contains "OpenCode", application MUST be "opencode", not "claude" or anything else.

CRITICAL DISTINCTION between "waiting_confirm" and "waiting_idle":
- "waiting_confirm": AI has a pending action needing approval. Look for prompts like "Proceed?", "Confirm?", "Do you want", "Approve", or tool use waiting for user consent. The AI is NOT idle - it has a specific question.
- "waiting_idle": AI is truly idle. Just showing a prompt symbol, no pending question or action. Either task finished or session just started.

IMPORTANT: If you see a shell prompt with no running command and no AI asking for confirmation, status MUST be "none", NOT "waiting_*".

CRITICAL RULE FOR ZSH: For zsh shell, status MUST always be "none", regardless of whether a command is running. Status rules about dead_loop, blocked, waiting_*, and running ONLY apply to AI CLI applications (claude, codex, opencode).`

const defaultUserPromptTemplate = `Current command: [%s]
Terminal content:
%s`

var defaultPromptSet = PromptSet{
	SystemByProvider: map[ProviderKind]string{
		ProviderAnthropic: defaultSystemPrompt,
		ProviderOpenAI:    defaultSystemPrompt,
	},
	UserPromptTemplate: defaultUserPromptTemplate,
}

func DefaultPrompts() PromptSet {
	return defaultPromptSet
}

func (p PromptSet) SystemPromptFor(provider ProviderKind) string {
	if prompt, ok := p.SystemByProvider[provider]; ok {
		return prompt
	}
	return defaultSystemPrompt
}

func (p PromptSet) BuildUserPrompt(input AnalyzeInput) string {
	return fmt.Sprintf(
		p.UserPromptTemplate,
		input.CurrentCommand,
		input.RawContent,
	)
}

func SystemPromptFor(provider ProviderKind) string {
	return defaultPromptSet.SystemPromptFor(provider)
}

func BuildUserPrompt(input AnalyzeInput) string {
	return defaultPromptSet.BuildUserPrompt(input)
}
