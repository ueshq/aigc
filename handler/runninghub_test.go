package handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
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
