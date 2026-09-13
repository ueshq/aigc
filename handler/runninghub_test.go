package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

func runningHubVideoForm(t *testing.T, fields [][2]string) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

func TestRunningHubVideoRequestPreparation(t *testing.T) {
	blockProtocolNetwork(t)
	channel := model.ModelChannel{Protocol: "runninghub", BaseURL: "https://www.runninghub.ai"}
	common := [][2]string{{"model", "kling-v3.0-pro/video"}, {"prompt", "scene"}, {"seconds", "8"}, {"size", "adaptive"}, {"resolution_name", "720p"}, {"preset", "normal"}, {"video_generate_audio", "false"}}
	body, contentType := runningHubVideoForm(t, append(common, [2]string{"first_frame_url", "https://media.example/first.png"}, [2]string{"last_frame_url", "https://media.example/last.png"}))
	got, err := prepareAIProtocolRequest(aiProtocolRequest{mode: aiProtocolVideoRequest, channel: channel, modelName: "kling-v3.0-pro/video", endpoint: "/videos", path: "/videos", contentType: contentType, body: body})
	if err != nil || got.path != "/kling-v3.0-pro/image-to-video" || got.contentType != "application/json" || got.failureLabel != "RunningHub" {
		t.Fatalf("got path %q, content type %q, stage %q, error %v", got.path, got.contentType, got.failureLabel, err)
	}
	assertProtocolBytes(t, got.body, []byte(`{"prompt":"scene","firstImageUrl":"https://media.example/first.png","lastImageUrl":"https://media.example/last.png","duration":"8","sound":false}`))

	body, contentType = runningHubVideoForm(t, append(common, [2]string{"input_reference[]", "https://media.example/reference.png"}))
	got, err = prepareAIProtocolRequest(aiProtocolRequest{mode: aiProtocolVideoRequest, channel: channel, modelName: "kling-v3.0-pro/video", endpoint: "/videos", path: "/videos", contentType: contentType, body: body})
	if err == nil || err.Error() != "该模型不支持参考素材" || got.path != "/videos" || got.failureLabel != "RunningHub" {
		t.Fatalf("got path %q, stage %q, error %v", got.path, got.failureLabel, err)
	}
}

func TestRunningHubVideoTaskTransform(t *testing.T) {
	channel := model.ModelChannel{Protocol: "runninghub"}
	request := httptest.NewRequest(http.MethodPost, "https://www.runninghub.ai/openapi/v2/query", nil)
	tests := []struct {
		name, payload, status, url, err string
	}{
		{"submitted", `{"taskId":"2013","status":"QUEUED","errorCode":"","errorMessage":""}`, "queued", "", ""},
		{"running", `{"taskId":"2013","status":"RUNNING"}`, "processing", "", ""},
		{"succeeded", `{"taskId":"2013","status":"SUCCESS","results":[{"url":"https://cdn.example/a.mp4","outputType":"mp4"}]}`, "completed", "https://cdn.example/a.mp4", ""},
		{"failed", `{"taskId":"2013","status":"FAILED","errorCode":"1505","errorMessage":"Real person prohibited"}`, "failed", "", "Real person prohibited"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transformed := transformVideoTaskPayload([]byte(test.payload), request, channel, "kling-v3.0-pro/video")
			parsed := parseVideoTaskPayload(transformed, "kling-v3.0-pro/video")
			if parsed.UpstreamTaskID != "2013" || parsed.Status != test.status || parsed.VideoURL != test.url || readVideoErrorMessage([]byte(test.payload), transformed) != test.err {
				t.Fatalf("got %+v from %s", parsed, transformed)
			}
		})
	}
}

func assertRunningHubJSON(t *testing.T, got []byte, want string) {
	t.Helper()
	var gotValue, wantValue any
	if json.Unmarshal(got, &gotValue) != nil || json.Unmarshal([]byte(want), &wantValue) != nil || !reflect.DeepEqual(gotValue, wantValue) {
		t.Fatalf("got %s; want %s", got, want)
	}
}

func TestRunningHubChatSpeechAnd3DPreparation(t *testing.T) {
	blockProtocolNetwork(t)
	channel := model.ModelChannel{Protocol: "runninghub", BaseURL: "https://www.runninghub.ai"}
	prepare := func(mode aiProtocolRequestMode, modelName, endpoint, contentType string, body []byte) aiProtocolRequest {
		t.Helper()
		got, err := prepareAIProtocolRequest(aiProtocolRequest{mode: mode, channel: channel, modelName: modelName, endpoint: endpoint, path: endpoint, contentType: contentType, body: body})
		if err != nil {
			t.Fatalf("%s: %v", modelName, err)
		}
		return got
	}

	chat := []byte(`{"model":"rhart-text-g-25-flash/text","stream":true,"messages":[{"role":"system","content":"Be brief."},{"role":"user","content":[{"type":"text","text":"Describe the clip"},{"type":"video_url","video_url":{"url":"https://media.example/clip.mp4"}}]}]}`)
	got := prepare(aiProtocolProxyRequest, "rhart-text-g-25-flash/text", "/chat/completions", "application/json", chat)
	if got.path != "/rhart-text-g-25-flash/video-to-text" || got.contentType != "application/json" {
		t.Fatalf("chat path %q, content type %q", got.path, got.contentType)
	}
	assertRunningHubJSON(t, got.body, `{"prompt":"Be brief.\n\nDescribe the clip","videoUrl":"https://media.example/clip.mp4"}`)

	speech := `{"model":"suno-v5/custom/music","input":"calm piano","voice":"alloy","speed":1,"extra_params":{"title":"Rain","tags":"piano"}}`
	got = prepare(aiProtocolProxyRequest, "suno-v5/custom/music", "/audio/speech", "application/json", []byte(speech))
	if got.path != "/rhart-audio/suno-v5/custom" {
		t.Fatalf("music path %q", got.path)
	}
	assertRunningHubJSON(t, got.body, `{"title":"Rain","prompt":"calm piano","tags":"piano"}`)
	if _, err := prepareAIProtocolRequest(aiProtocolRequest{mode: aiProtocolProxyRequest, channel: channel, modelName: "suno-v5/custom/music", endpoint: "/audio/speech", path: "/audio/speech", contentType: "application/json", body: []byte(`{"input":"calm piano","extra_params":"{\"title\":\"Rain\"}"}`)}); err == nil || err.Error() != "请填写参数 tags" {
		t.Fatalf("missing tags error = %v", err)
	}

	form, contentType := runningHubVideoForm(t, [][2]string{{"model", "hitem3d-v15/model3d"}, {"prompt", ""}, {"input_reference[]", "https://media.example/a.png"}, {"extra_params", `{"resolution":"512"}`}})
	got = prepare(aiProtocolVideoRequest, "hitem3d-v15/model3d", "/videos", contentType, form)
	if got.path != "/hitem3d-v15/image-to-3d" {
		t.Fatalf("3D path %q", got.path)
	}
	assertRunningHubJSON(t, got.body, `{"requestType":"mesh","imageUrl":"https://media.example/a.png","resolution":"512"}`)

	request := httptest.NewRequest(http.MethodPost, "https://www.runninghub.ai/openapi/v2/query", nil)
	transformed := transformVideoTaskPayload([]byte(`{"taskId":"2013","status":"SUCCESS","results":[{"url":"https://cdn.example/preview.png"},{"url":"https://cdn.example/model.glb"}]}`), request, channel, "hitem3d-v15/model3d")
	if parsed := parseVideoTaskPayload(transformed, "hitem3d-v15/model3d"); parsed.Status != "completed" || parsed.VideoURL != "https://cdn.example/model.glb" {
		t.Fatalf("3D task %+v from %s", parsed, transformed)
	}
}
