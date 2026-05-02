package intelligence

import "testing"

func TestDefaultPrompts(t *testing.T) {
	ps := DefaultPrompts()

	if ps.SystemByProvider == nil {
		t.Fatal("SystemByProvider should not be nil")
	}

	if ps.UserPromptTemplate == "" {
		t.Fatal("UserPromptTemplate should not be empty")
	}
}

func TestSystemPromptFor(t *testing.T) {
	anthropic := SystemPromptFor(ProviderAnthropic)
	openai := SystemPromptFor(ProviderOpenAI)

	if anthropic == "" {
		t.Fatal("anthropic system prompt should not be empty")
	}
	if openai == "" {
		t.Fatal("openai system prompt should not be empty")
	}
	if anthropic != openai {
		t.Fatal("expected anthropic and openai to share the same default system prompt")
	}
}

func TestPromptSet_SystemPromptFor_UnknownProvider(t *testing.T) {
	ps := DefaultPrompts()
	got := ps.SystemPromptFor(ProviderKind("unknown"))

	if got == "" {
		t.Fatal("unknown provider should fallback to default system prompt")
	}
}

func TestBuildUserPrompt(t *testing.T) {
	input := AnalyzeInput{
		CurrentCommand: "ls -la",
		RawContent:     "file1\nfile2",
	}

	got := BuildUserPrompt(input)
	want := "Current command: [ls -la]\nTerminal content:\nfile1\nfile2"

	if got != want {
		t.Fatalf("unexpected user prompt:\n got: %q\nwant: %q", got, want)
	}
}

func TestPromptSet_BuildUserPrompt(t *testing.T) {
	ps := PromptSet{
		UserPromptTemplate: "cmd: %s, content: %s",
	}

	input := AnalyzeInput{
		CurrentCommand: "echo hi",
		RawContent:     "hi",
	}

	got := ps.BuildUserPrompt(input)
	want := "cmd: echo hi, content: hi"

	if got != want {
		t.Fatalf("unexpected user prompt:\n got: %q\nwant: %q", got, want)
	}
}
