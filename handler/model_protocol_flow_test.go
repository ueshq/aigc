package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestModelProtocolChannelFlow(t *testing.T) {
	// The repository singleton is private: a child isolates its sync.Once and DB.
	const marker = "MODEL_PROTOCOL_CHANNEL_FLOW_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestModelProtocolChannelFlow$", "-test.timeout=40s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated channel flow: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}
	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	blockProtocolNetwork(t)
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	user := model.User{ID: "channel-flow-user", Username: "channel-flow-user", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	// Representative channel contracts; model variants and precedence have separate fixtures.
	tests := []struct {
		name, protocol, modelName, endpoint, body, path, wantBody, payload, pollPath, pollPayload, wantResponse, message string
		local, transient                                                                                                 bool
	}{
		{name: "Gemini nonstream", protocol: "gemini", modelName: "gemini-text", endpoint: "/chat/completions", body: `{"model":"gemini-text","stream":false,"contents":[]}`, path: "/v1beta/models/gemini-text:generateContent", wantBody: `{"contents":[]}`, payload: `{"candidates":[]}`},
		{name: "Gemini stream", protocol: "gemini", modelName: "gemini-text", endpoint: "/chat/completions", body: `{"model":"gemini-text","stream":true,"contents":[]}`, path: "/v1beta/models/gemini-text:streamGenerateContent?alt=sse", wantBody: `{"contents":[]}`, payload: `{"candidates":[]}`},
		{name: "MiMo audio", protocol: "mimo", modelName: "mimo-v2.5-tts", endpoint: "/audio/speech", body: `{"model":"mimo-v2.5-tts","input":" hello "}`, path: "/v1/chat/completions", wantBody: `{"model":"mimo-v2.5-tts","messages":[{"role":"assistant","content":"hello"}],"audio":{"format":"wav","voice":"冰糖"}}`, payload: `{"choices":[{"message":{"audio":{"data":"AQID"}}}]}`, wantResponse: "\x01\x02\x03"},
		{name: "MiniMax video create", protocol: "minimax", modelName: "MiniMax-H3", endpoint: "/videos", body: `{"model":"MiniMax-H3","content":[{"type":"text","text":"scene"}],"resolution":"768P","duration":5,"ratio":"16:9"}`, path: "/v2/video_generation", payload: `{"task_id":"upstream-job","status":"processing"}`, pollPath: "/v2/query/video_generation/upstream-job", pollPayload: `{"task":{"id":"upstream-job","status":"succeeded","content":{"url":"https://media.invalid/video"}}}`},
		{name: "MiniMax Max personal channel", protocol: "minimax", local: true, modelName: "MiniMax-H3-Max", endpoint: "/videos", body: `{"model":"MiniMax-H3-Max","content":[{"type":"text","text":"scene"}],"resolution":"768P","duration":5,"ratio":"16:9"}`, path: "/v2/video_generation", payload: `{"task_id":"upstream-job","status":"processing"}`, pollPath: "/v2/query/video_generation/upstream-job", pollPayload: `{"task":{"id":"upstream-job","status":"succeeded","content":{"url":"https://media.invalid/video"}}}`},
		{name: "MiniMax 2K regeneration", protocol: "minimax", modelName: "MiniMax-H3-Regenerate-2K", endpoint: "/videos", body: `{"model":"MiniMax-H3-Regenerate-2K","resolution":"2K","aigc_watermark":true,"content":[{"type":"text","text":"scene"},{"type":"video_url","video_url":{"url":"https://media.invalid/base.mp4"},"role":"base_video"}]}`, path: "/v2/video_regeneration", wantBody: `{"model":"MiniMax-H3","resolution":"2K","aigc_watermark":true,"content":[{"type":"text","text":"scene"},{"type":"video_url","video_url":{"url":"https://media.invalid/base.mp4"},"role":"base_video"}]}`, payload: `{"task_id":"upstream-job","status":"processing"}`, pollPath: "/v2/query/video_generation/upstream-job", pollPayload: `{"task":{"id":"upstream-job","status":"succeeded","task_type":"regeneration","resolution":"2K","content":{"url":"https://media.invalid/video"}}}`},
		{name: "MiniMax Context-IR personal channel", protocol: "minimax", local: true, transient: true, modelName: "MiniMax-H3-Context-IR", endpoint: "/videos", body: `{"model":"MiniMax-H3-Context-IR","content":[{"type":"text","text":"scene"}],"duration":5,"ratio":"16:9"}`, path: "/v2/h3_context_ir", wantBody: `{"model":"MiniMax-H3","content":[{"type":"text","text":"scene"}],"duration":5,"ratio":"16:9"}`, payload: `{"task_id":"context-job"}`, pollPath: "/v2/query/video_generation/context-job", pollPayload: `{"task":{"id":"context-job","status":"succeeded","task_type":"h3_context_ir","modality":"text","content":{"prompt":"enhanced scene"}}}`},
		{name: "CogVideoX3 create", modelName: "cogvideox-3", endpoint: "/videos", body: `{"model":"cogvideox-3","prompt":"scene"}`, path: "/v1/videos/generations", payload: `{"id":"upstream-job","status":"processing"}`},
		{name: "Ark Seedance create", protocol: "ark", modelName: "doubao-seedance-2", endpoint: "/videos", body: `{"model":"doubao-seedance-2","content":[{"type":"text","text":"scene"}]}`, path: "/v1/contents/generations/tasks", payload: `{"id":"upstream-job","status":"processing"}`},
		{name: "Gemini video error response", protocol: "gemini", modelName: "veo", endpoint: "/videos", body: `{"model":"veo","contents":[]}`, path: "/v1beta/models/veo:predictLongRunning", wantBody: `{"contents":[]}`, payload: `{"name":"operations/job"}`, message: `{"message":""}`},
		{name: "OpenAI chat", protocol: "openai", endpoint: "/chat/completions", body: `{"model":"future-model","messages":[]}`, path: "/v1/chat/completions", payload: `{"choices":[]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			test.protocol = firstNonEmpty(test.protocol, "openai")
			test.modelName = firstNonEmpty(test.modelName, "future-model")
			test.body = firstNonEmpty(test.body, `{"model":"future-model"}`)
			test.wantBody = firstNonEmpty(test.wantBody, test.body)
			channel := model.ModelChannel{ID: "channel", Name: "fixture", Protocol: test.protocol, BaseURL: "https://upstream.invalid", APIKey: "remote-key", Models: []string{service.MiniMaxChannelModelName(test.modelName)}, Enabled: true, Weight: 1}
			if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{channel}}}, "fixture"); err != nil {
				t.Fatal(err)
			}
			key, localID := channel.APIKey, ""
			if test.local {
				key, localID = "local-key", channel.ID
				channel.APIKey = key
				body, err := json.Marshal(map[string]any{"localChannels": []model.ModelChannel{channel}})
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Save(&model.UserConfig{UserID: user.ID, ModelConfig: string(body)}).Error; err != nil {
					t.Fatal(err)
				}
			}
			calls, closed, wantCalls := 0, 0, 1
			if test.pollPath != "" {
				wantCalls = 2
			}
			protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
				calls++
				path, method, payload := test.path, http.MethodPost, test.payload
				if calls == 2 {
					path, method, payload = test.pollPath, http.MethodGet, test.pollPayload
				}
				auth, google := "Bearer "+key, ""
				if test.protocol == "gemini" {
					auth, google = "", key
				}
				if calls > wantCalls || request.Method != method || request.URL.String() != channel.BaseURL+path || request.Header.Get("Authorization") != auth || request.Header.Get("x-goog-api-key") != google {
					t.Fatalf("unexpected request %d: %s %s %v", calls, request.Method, request.URL, request.Header)
				}
				if method == http.MethodPost {
					body, err := io.ReadAll(request.Body)
					if err != nil || request.Header.Get("Content-Type") != "application/json" {
						t.Fatalf("request body: %s, %v", body, err)
					}
					assertProtocolJSONValue(t, json.RawMessage(body), test.wantBody)
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: &protocolResponseBody{Reader: strings.NewReader(payload), closed: &closed}}, nil
			})
			taskID := "client_video_task_" + test.name
			request := httptest.NewRequest(http.MethodPost, test.endpoint, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Model-Channel-ID", channel.ID)
			request.Header.Set(userModelChannelHeader, localID)
			request.Header.Set("X-Client-Video-Task-ID", taskID)
			request = request.WithContext(service.WithUser(request.Context(), model.PublicUser(user)))
			writer := httptest.NewRecorder()
			switch test.endpoint {
			case "/chat/completions":
				AIChatCompletions(writer, request)
			case "/audio/speech":
				AIAudioSpeech(writer, request)
			case "/images/generations":
				AIImagesGenerations(writer, request)
			case "/images/edits":
				AIImagesEdits(writer, request)
			case "/videos":
				AIVideos(writer, request)
			default:
				t.Fatalf("unhandled fixture endpoint: %s", test.endpoint)
			}
			if writer.Code != http.StatusOK {
				t.Fatalf("HTTP %d: %s", writer.Code, writer.Body)
			}
			switch {
			case test.message != "":
				var result response
				if json.Unmarshal(writer.Body.Bytes(), &result) != nil || result.Code != 1 || result.Msg != test.message {
					t.Fatalf("error response: %s", writer.Body)
				}
			case test.transient:
				envelope := protocolRecord(t, protocolJSON(t, writer.Body.String()))
				data := protocolRecord(t, envelope["data"])
				if envelope["code"] != float64(0) || data["id"] != "context-job" || data["model"] != test.modelName || data["userChannelId"] != localID {
					t.Fatalf("transient task response: %s", writer.Body)
				}
				if _, found, _ := repository.GetVideoTask(taskID); found {
					t.Fatal("Context-IR must not create a video task")
				}
				poll := httptest.NewRequest(http.MethodGet, "/videos/context-job?model=MiniMax-H3", nil)
				poll.Header.Set("X-Model-Channel-ID", channel.ID)
				poll.Header.Set(userModelChannelHeader, localID)
				poll = poll.WithContext(service.WithUser(poll.Context(), model.PublicUser(user)))
				pollWriter := httptest.NewRecorder()
				AIVideo(pollWriter, poll, "context-job")
				assertProtocolJSONValue(t, protocolJSON(t, pollWriter.Body.String()), test.pollPayload)
			case test.endpoint == "/videos":
				envelope := protocolRecord(t, protocolJSON(t, writer.Body.String()))
				data := protocolRecord(t, envelope["data"])
				if envelope["code"] != float64(0) || data["id"] != taskID || data["task_id"] != "upstream-job" || data["model"] != test.modelName || data["channelId"] != channel.ID || data["userChannelId"] != localID || data["status"] != "processing" {
					t.Fatalf("video response: %s", writer.Body)
				}
				if test.pollPath != "" {
					task, found, err := repository.GetVideoTask(taskID)
					if err != nil || !found {
						t.Fatalf("task unavailable for poll: %v", err)
					}
					update, err := pollVideoTaskFromUpstream(task)
					if err != nil || update.Status != "completed" || update.VideoURL != "https://media.invalid/video" {
						t.Fatalf("poll response: %#v, %v", update, err)
					}
				}
			case test.endpoint == "/audio/speech":
				if writer.Body.String() != test.wantResponse || writer.Header().Get("Content-Type") != "application/octet-stream" {
					t.Fatalf("audio response: %v %q", writer.Header(), writer.Body.String())
				}
			default:
				body := protocolJSON(t, writer.Body.String())
				if strings.HasPrefix(test.endpoint, "/images/") {
					delete(protocolRecord(t, body), "created")
				}
				assertProtocolJSONValue(t, body, firstNonEmpty(test.wantResponse, test.payload))
			}
			if calls != wantCalls || closed != calls {
				t.Fatalf("requests/closed=%d/%d, want=%d", calls, closed, wantCalls)
			}
		})
	}
}
