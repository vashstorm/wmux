package semantic

type Classifier interface {
	Classify(output string) SemanticEventType
}

type RulesClassifier struct{}

func (RulesClassifier) Classify(output string) SemanticEventType {
	return Classify(output)
}

type NopClassifier struct{}

func (NopClassifier) Classify(_ string) SemanticEventType {
	return EventNone
}
