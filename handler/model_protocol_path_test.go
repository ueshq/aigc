package handler

import (
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

// Retained protocols and model-specific routes must remain independent.
func TestModelProtocolProxyPathContract(t *testing.T) {
	tests := []struct {
		name, protocol, baseURL, model, path, want string
	}{
		{"gemini chat", "gemini", "", "models/gemini-test", "/chat/completions", "/v1beta/models/gemini-test:streamGenerateContent?alt=sse"},
		{"gemini speech before mimo", "gemini", "", "mimo-v2.5-tts", "/audio/speech", "/v1beta/models/mimo-v2.5-tts:generateContent"},
		{"gemini video before cog", " GEMINI ", "", "cogvideox-3", "/videos", "/v1beta/models/cogvideox-3:predictLongRunning"},
		{"gemini operation", "gemini", "", "veo", "/videos/operations/task", "/v1beta/operations/task"},
		{"minimax create", "minimax", "https://api.minimax.io", "MiniMax-H3", "/videos", "/v2/video_generation"},
		{"minimax max create", "minimax", "https://api.minimax.io", "MiniMax-H3-Max", "/videos", "/v2/video_generation"},
		{"minimax query", "minimax", "", "MiniMax-H3-Max", "/videos/task a?b", "/v2/query/video_generation/task%20a%3Fb"},
		{"cog create", "openai", "", " COGVIDEOX-3 ", "/videos", "/videos/generations"},
		{"openai seedance unchanged", "openai", "", "doubao-seedance-2", "/videos", "/videos"},
		{"openai plan URL unchanged", "openai", "https://api.example/API/PLAN/V3", "deployment-id", "/videos", "/videos"},
		{"ark create", "ark", "https://ark.cn-beijing.volces.com/api/v3", "doubao-seedance-2.0", "/videos", "/contents/generations/tasks"},
		{"ark poll", "ark", "https://ark.cn-beijing.volces.com/api/plan/v3", "doubao-seedance-2.0", "/videos/task a?b", "/contents/generations/tasks/task a?b"},
		{"removed provider URL stays compatible", "openai", "https://api.kie.ai", "vendor/kie/model", "/videos", "/videos"},
		{"removed image URL stays compatible", "openai", "https://api.apimart.ai", "gpt-image-2", "/images/edits", "/images/edits"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			channel := model.ModelChannel{Protocol: test.protocol, BaseURL: test.baseURL}
			if got := resolveAIProxyPath(channel, test.model, test.path); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
	for _, protocol := range []string{"", "openai", "minimax", "mimo", "future-protocol"} {
		for _, path := range []string{"/chat/completions", "/responses", "/images/generations", "/images/edits", "/audio/speech", "/videos", "/videos/task", "/models"} {
			if got := resolveAIProxyPath(model.ModelChannel{Protocol: protocol}, "future-model", path); got != path {
				t.Errorf("passthrough %q %q: got %q", protocol, path, got)
			}
		}
	}
}

func TestModelProtocolProxyURLContract(t *testing.T) {
	tests := []struct {
		name, protocol, baseURL, model, path, want string
	}{
		{"default version", "openai", " https://api.example/ ", "model", "/models", "https://api.example/v1/models"},
		{"existing v1", "openai", "https://api.example/v1/", "model", "/videos", "https://api.example/v1/videos"},
		{"gemini base version", "gemini", "https://api.example/v1beta/", "model", "/v1beta/models/model:generateContent", "https://api.example/v1beta/models/model:generateContent"},
		{"minimax no v1", "minimax", "https://api.example/", "MiniMax-H3", "/v2/video_generation", "https://api.example/v2/video_generation"},
		{"agnes query", "openai", "https://api.example/v1/", "agnes-video-2.5", "/videos/video_a b", "https://api.example/agnesapi?model_name=agnes-video-2.5&video_id=video_a+b"},
		{"agnes wins protocol URL builder", "gemini", "https://api.example/v1", "agnes-video-2.5", "/videos/video_task", "https://api.example/agnesapi?model_name=agnes-video-2.5&video_id=video_task"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			channel := model.ModelChannel{Protocol: test.protocol, BaseURL: test.baseURL}
			if got := resolveAIProxyURL(channel, test.model, test.path); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestModelProtocolProxyPreparationOrder(t *testing.T) {
	blockProtocolNetwork(t)
	tests := []struct {
		name, protocol, baseURL, model, endpoint, path, body string
		wantPath, wantBody, wantLabel, wantError             string
		mode                                                 aiProtocolRequestMode
	}{
		{
			name: "Gemini continues MiMo and retains Gemini path", protocol: "gemini", baseURL: "https://upstream.invalid", model: "mimo-v2.5-tts", endpoint: "/audio/speech",
			body:     `{"model":"discarded-by-Gemini","stream":true,"input":" hello ","instructions":" calm ","response_format":"MP3"}`,
			wantPath: "/v1beta/models/mimo-v2.5-tts:generateContent", wantLabel: "MiMo TTS",
			wantBody: `{"model":"mimo-v2.5-tts","messages":[{"role":"user","content":"calm"},{"role":"assistant","content":"hello"}],"audio":{"format":"mp3","voice":"冰糖"}}`,
		},
		{
			name: "Gemini malformed body stops before MiMo", protocol: "gemini", model: "mimo-v2.5-tts", endpoint: "/audio/speech", body: `{`,
			wantPath: "/v1beta/models/mimo-v2.5-tts:generateContent", wantLabel: "Gemini", wantError: "unexpected end of JSON input",
		},
		{
			name: "Gemini video strips model", protocol: "gemini", model: "veo", endpoint: "/videos", mode: aiProtocolVideoRequest,
			body: `{"model":"veo","instances":[]}`, wantPath: "/v1beta/models/veo:predictLongRunning", wantLabel: "Gemini", wantBody: `{"instances":[]}`,
		},
		{
			name: "compatible passthrough", protocol: "unknown", model: "future-model", endpoint: "/chat/completions", body: `not JSON`,
			wantPath: "/chat/completions", wantBody: `not JSON`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			channel := model.ModelChannel{Protocol: test.protocol, BaseURL: test.baseURL}
			path := test.path
			if path == "" {
				path = resolveAIProxyPath(channel, test.model, test.endpoint)
			}
			// Exercise the pure stage extracted from proxyAIRequest, without its
			// database selection, billing, upstream request or logging side effects.
			got, err := prepareAIProtocolRequest(aiProtocolRequest{
				mode: test.mode, channel: channel, modelName: test.model,
				endpoint: test.endpoint, path: path, contentType: "application/json", body: []byte(test.body),
			})
			if got.path != test.wantPath || got.failureLabel != test.wantLabel {
				t.Fatalf("got path %q, stage %q; want %q, %q", got.path, got.failureLabel, test.wantPath, test.wantLabel)
			}
			if test.wantError != "" {
				if err == nil || err.Error() != test.wantError {
					t.Fatalf("got error %v; want %q", err, test.wantError)
				}
				return
			}
			if err != nil || got.contentType != "application/json" {
				t.Fatalf("got content type %q, error %v", got.contentType, err)
			}
			assertProtocolBytes(t, got.body, []byte(test.wantBody))
		})
	}
}

