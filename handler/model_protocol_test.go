package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func protocolJSON(t *testing.T, text string) any {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatalf("invalid fixture JSON: %v", err)
	}
	return value
}

func assertProtocolJSONValue(t *testing.T, got any, want string) {
	t.Helper()
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(protocolJSON(t, string(encoded)), protocolJSON(t, want)) {
		t.Fatalf("got %s; want %s", encoded, want)
	}
}

func blockProtocolNetwork(t *testing.T) {
	t.Helper()
	protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
		t.Errorf("unexpected upstream request: %s %s", request.Method, request.URL)
		return nil, errors.New("contract test forbids upstream network I/O")
	})
}

func assertProtocolBytes(t *testing.T, got, want []byte) {
	t.Helper()
	if json.Valid(got) && json.Valid(want) {
		assertProtocolJSONValue(t, protocolJSON(t, string(got)), string(want))
	} else if !bytes.Equal(got, want) {
		t.Fatalf("raw payload changed: got %q, want %q", got, want)
	}
}

type protocolTransport func(*http.Request) (*http.Response, error)

func (transport protocolTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func protocolMockHTTP(t *testing.T, transport protocolTransport) {
	t.Helper()
	previous := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previous })
}

type protocolResponseBody struct {
	io.Reader
	closed *int
}

func (body *protocolResponseBody) Close() error {
	*body.closed++
	return nil
}

func protocolRecord(t *testing.T, value any) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %#v", value)
	}
	return record
}

func TestMiniMaxVideoResponses(t *testing.T) {
	for _, modelName := range []string{"MiniMax-H3", "MiniMax-H3-Max"} {
		channel := model.ModelChannel{Protocol: "minimax", BaseURL: "https://api.minimax.io"}
		request := httptest.NewRequest(http.MethodGet, channel.BaseURL+"/v2/query/video_generation/job", nil)
		for _, test := range []struct{ name, payload, status, videoURL, message string }{
			{"queued", `{"task":{"id":"job","status":"queued"}}`, "queued", "", ""},
			{"running", `{"task":{"id":"job","status":"running"}}`, "processing", "", ""},
			{"success", `{"task":{"id":"job","status":"succeeded","content":{"url":"https://media.example/video.mp4"},"duration":5,"resolution":"768P","ratio":"16:9"}}`, "completed", "https://media.example/video.mp4", ""},
			{"missing output", `{"task":{"id":"job","status":"succeeded"}}`, "failed", "", "MiniMax 视频生成完成但没有返回视频地址"},
			{"failed", `{"task":{"id":"job","status":"failed","error":{"code":"1026","message":"rejected"}}}`, "failed", "", "rejected"},
			{"cancelled", `{"task":{"id":"job","status":"cancelled"}}`, "failed", "", "视频任务生成失败"},
		} {
			t.Run(modelName+"/"+test.name, func(t *testing.T) {
				payload := transformVideoTaskPayload([]byte(test.payload), request, channel, modelName)
				got := parseVideoTaskPayload(payload, modelName)
				if got.UpstreamTaskID != "job" || got.Status != test.status || got.VideoURL != test.videoURL || got.Error != test.message {
					t.Fatalf("unexpected task: %+v", got)
				}
			})
		}
		created := parseVideoTaskPayload([]byte(`{"task_id":"job"}`), modelName)
		if created.UpstreamTaskID != "job" { t.Fatalf("missing create ID: %+v", created) }
		if message := readNormalizedVideoError([]byte(`{"type":"error","error":{"type":"authorized_error","message":"invalid key","http_code":"401"}}`)); message != "invalid key" {
			t.Fatalf("lost upstream authentication error: %q", message)
		}
	}
}
