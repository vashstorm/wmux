package protocol_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/panh/wmux/internal/protocol"
)

func TestClientMessageJSON(t *testing.T) {
	tests := []struct {
		name    string
		message protocol.ClientMessage
		want    string
	}{
		{
			name:    "input",
			message: protocol.ClientMessage{Type: protocol.ClientMessageTypeInput, Data: "ls\n"},
			want:    `{"type":"input","data":"ls\n"}`,
		},
		{
			name:    "resize",
			message: protocol.ClientMessage{Type: protocol.ClientMessageTypeResize, Rows: 24, Cols: 80},
			want:    `{"type":"resize","cols":80,"rows":24}`,
		},
		{
			name:    "close",
			message: protocol.ClientMessage{Type: protocol.ClientMessageTypeClose},
			want:    `{"type":"close"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload, err := json.Marshal(tt.message)
			if err != nil {
				t.Fatalf("failed to marshal client message: %v", err)
			}

			if string(payload) != tt.want {
				t.Fatalf("unexpected json payload: %s", string(payload))
			}

			var decoded protocol.ClientMessage
			if err := json.Unmarshal(payload, &decoded); err != nil {
				t.Fatalf("failed to unmarshal client message: %v", err)
			}

			if !reflect.DeepEqual(decoded, tt.message) {
				t.Fatalf("unexpected decoded message: %#v", decoded)
			}
		})
	}
}

func TestServerMessageJSON(t *testing.T) {
	tests := []struct {
		name    string
		message protocol.ServerMessage
		want    string
	}{
		{
			name:    "output",
			message: protocol.ServerMessage{Type: protocol.ServerMessageTypeOutput, Data: "hello"},
			want:    `{"type":"output","data":"hello"}`,
		},
		{
			name:    "status",
			message: protocol.ServerMessage{Type: protocol.ServerMessageTypeStatus, Status: "connected"},
			want:    `{"type":"status","status":"connected"}`,
		},
		{
			name: "error",
			message: protocol.ServerMessage{
				Type:  protocol.ServerMessageTypeError,
				Error: &protocol.ErrorDetail{Code: "internal_error", Message: "boom"},
			},
			want: `{"type":"error","error":{"code":"internal_error","message":"boom"}}`,
		},
		{
			name:    "close",
			message: protocol.ServerMessage{Type: protocol.ServerMessageTypeClose},
			want:    `{"type":"close"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload, err := json.Marshal(tt.message)
			if err != nil {
				t.Fatalf("failed to marshal server message: %v", err)
			}

			if string(payload) != tt.want {
				t.Fatalf("unexpected json payload: %s", string(payload))
			}

			var decoded protocol.ServerMessage
			if err := json.Unmarshal(payload, &decoded); err != nil {
				t.Fatalf("failed to unmarshal server message: %v", err)
			}

			if !reflect.DeepEqual(decoded, tt.message) {
				t.Fatalf("unexpected decoded message: %#v", decoded)
			}
		})
	}
}

func TestErrorResponseJSON(t *testing.T) {
	payload, err := json.Marshal(protocol.ErrorResponse{
		Error: protocol.ErrorDetail{Code: "unauthorized", Message: "missing token"},
	})
	if err != nil {
		t.Fatalf("failed to marshal error response: %v", err)
	}

	if string(payload) != `{"error":{"code":"unauthorized","message":"missing token"}}` {
		t.Fatalf("unexpected json payload: %s", string(payload))
	}
}
