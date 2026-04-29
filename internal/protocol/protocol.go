package protocol

const (
	ClientMessageTypeInput  = "input"
	ClientMessageTypeResize = "resize"
	ClientMessageTypeClose  = "close"

	ServerMessageTypeOutput = "output"
	ServerMessageTypeStatus = "status"
	ServerMessageTypeError  = "error"
	ServerMessageTypeClose  = "close"
)

type ClientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

type ServerMessage struct {
	Type   string       `json:"type"`
	Data   string       `json:"data,omitempty"`
	Status string       `json:"status,omitempty"`
	Error  *ErrorDetail `json:"error,omitempty"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}
