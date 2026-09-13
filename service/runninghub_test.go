package service

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestRunningHubRegistryFamilies(t *testing.T) {
	models := RunningHubModels()
	if len(models) < 100 || !slices.IsSorted(models) {
		t.Fatalf("unexpected RunningHub catalog: %d models", len(models))
	}
	for name, modes := range runningHubRegistry().Families {
		kind := name[strings.LastIndex(name, "/")+1:]
		if kind != "video" && kind != "image" && kind != "tts" && kind != "music" || len(modes) == 0 {
			t.Errorf("family %q needs a capability suffix and modes", name)
		}
		for mode, endpoints := range modes {
			for _, endpoint := range endpoints {
				if _, ok := runningHubRegistry().Endpoints[endpoint]; !ok {
					t.Errorf("%s %s references missing endpoint %s", name, mode, endpoint)
				}
			}
		}
	}
	if !isVideoModelName("kling-v3.0-pro/video") || !isImageModelName("seedream-v4.5/image") || isTextModelName("minimax/speech-2.6-hd/tts") {
		t.Fatal("RunningHub family names are classified incorrectly")
	}
}

func TestSelectRunningHubEndpoint(t *testing.T) {
	urls := func(count int) []RunningHubMedia {
		return slices.Repeat([]RunningHubMedia{{URL: "https://media.example/a.png"}}, count)
	}
	tests := []struct {
		name, model string
		media       map[string][]RunningHubMedia
		want, err   string
	}{
		{"text", "kling-v3.0-pro/video", nil, "kling-v3.0-pro/text-to-video", ""},
		{"first and last frames", "kling-v3.0-pro/video", map[string][]RunningHubMedia{"first": urls(1), "last": urls(1)}, "kling-v3.0-pro/image-to-video", ""},
		{"first frame", "kling-video-o1/video", map[string][]RunningHubMedia{"first": urls(1)}, "kling-video-o1/image-to-video", ""},
		{"start and end frames", "kling-video-o1/video", map[string][]RunningHubMedia{"first": urls(1), "last": urls(1)}, "kling-video-o1/start-to-end", ""},
		{"unsupported references", "kling-v3.0-pro/video", map[string][]RunningHubMedia{"images": urls(1)}, "", "该模型不支持参考素材"},
		{"reference images", "rhart-video-v3.1-fast/video", map[string][]RunningHubMedia{"images": urls(3)}, "rhart-video-v3.1-fast/image-to-video", ""},
		{"too many references", "rhart-video-v3.1-fast/video", map[string][]RunningHubMedia{"images": urls(4)}, "", "素材数量或组合不符合该模型要求：首帧 0、尾帧 0、参考图 4、参考视频 0、参考音频 0"},
		{"text to image", "seedream-v4.5/image", nil, "seedream-v4.5/text-to-image", ""},
		{"image edit", "seedream-v4.5/image", map[string][]RunningHubMedia{"images": urls(2)}, "seedream-v4.5/image-to-image", ""},
		{"edit-only image", "higgsfield/soul/image", nil, "", "该模型需要参考图"},
		{"speech", "minimax/speech-2.6-hd/tts", nil, "rhart-audio/text-to-audio/speech-2.6-hd", ""},
		{"frame-only video needs a first frame", "higgsfield/dop/video", nil, "", "该模型需要首帧"},
		{"video tool", "rhart-video/video-upscaler/video", map[string][]RunningHubMedia{"videos": urls(1)}, "rhart-video/video-upscaler", ""},
		{"video tool needs a video", "rhart-video/video-upscaler/video", nil, "", "该模型需要参考视频"},
		{"motion control needs a character image", "kling-v2.6-std/motion-control/video", map[string][]RunningHubMedia{"videos": urls(1)}, "", "该模型需要首帧"},
		{"motion control", "kling-v2.6-std/motion-control/video", map[string][]RunningHubMedia{"first": urls(1), "videos": urls(1)}, "kling-v2.6-std/motion-control", ""},
		{"music", "suno-v5/single/music", nil, "rhart-audio/suno-v5/single", ""},
		{"music cover needs audio", "minimax/music-cover/music", nil, "", "该模型需要参考音频"},
		{"music cover", "minimax/music-cover/music", map[string][]RunningHubMedia{"audios": urls(1)}, "minimax/music-cover", ""},
		{"unknown family", "kling-v3.0-pro", nil, "", "RunningHub 暂不支持模型 kling-v3.0-pro"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := SelectRunningHubEndpoint(test.model, test.media)
			if got != test.want || err == nil && test.err != "" || err != nil && err.Error() != test.err {
				t.Fatalf("got %q, %v; want %q, %q", got, err, test.want, test.err)
			}
		})
	}
}

func TestBuildRunningHubPayload(t *testing.T) {
	frames := map[string][]RunningHubMedia{"first": {{URL: "https://media.example/first.png"}}, "last": {{URL: "https://media.example/last.png"}}}
	images := map[string][]RunningHubMedia{"images": {{URL: "https://media.example/a.png"}, {URL: "https://media.example/b.png"}}}
	tests := []struct {
		name, endpoint string
		inputs         RunningHubInputs
		want           string
	}{
		{"list duration, ratio and boolean audio", "kling-v3.0-pro/text-to-video", RunningHubInputs{Prompt: " scene ", Seconds: "7", Size: "9:16", GenerateAudio: "false"}, `{"prompt":"scene","duration":"7","aspectRatio":"9:16","sound":false}`},
		{"nearest options and required defaults", "kling-v3.0-pro/text-to-video", RunningHubInputs{Prompt: "scene", Seconds: "30", Size: "1280x720"}, `{"prompt":"scene","duration":"15","aspectRatio":"16:9","sound":true}`},
		{"frames", "kling-v3.0-pro/image-to-video", RunningHubInputs{Prompt: "scene", Size: "adaptive", Media: frames}, `{"prompt":"scene","firstImageUrl":"https://media.example/first.png","lastImageUrl":"https://media.example/last.png","duration":"5","sound":true}`},
		{"size from ratio and resolution", "alibaba/wan-2.5-preview/text-to-video", RunningHubInputs{Prompt: "scene", Seconds: "5", Size: "9:16", Resolution: "720p"}, `{"prompt":"scene","duration":"5","size":"720*1280"}`},
		{"square 1080p size", "alibaba/wan-2.5-preview/text-to-video", RunningHubInputs{Prompt: "scene", Size: "1:1", Resolution: "1080p"}, `{"prompt":"scene","duration":"5","size":"1440*1440"}`},
		{"pixel size list", "rhart-video-s-official/text-to-video-pro", RunningHubInputs{Prompt: "scene", Seconds: "10", Size: "16:9", Resolution: "1080p"}, `{"prompt":"scene","size":"1920x1080","duration":"8"}`},
		{"case-insensitive resolution", "alibaba/wan-2.7/text-to-video", RunningHubInputs{Prompt: "scene", Seconds: "6", Size: "4:3", Resolution: "1080p"}, `{"prompt":"scene","duration":"6","resolution":"1080P","aspectRatio":"4:3"}`},
		{"resolution alias, INT duration and adaptive ratio", "rhart-video-flux3/text-to-video", RunningHubInputs{Prompt: "scene", Seconds: "30", Size: "adaptive", Resolution: "1080p", GenerateAudio: "true"}, `{"prompt":"scene","aspectRatio":"auto","duration":20,"resolution":"fhd","generateAudio":true}`},
		{"list audio switch", "seedance-v1.5-pro/text-to-video", RunningHubInputs{Prompt: "scene", Seconds: "5", Size: "16:9", Resolution: "480p", GenerateAudio: "false"}, `{"prompt":"scene","aspectRatio":"16:9","duration":"5","resolution":"480p","generateAudio":"false","cameraFixed":"false"}`},
		{"pixel image size", "seedream-v4.5/image-to-image", RunningHubInputs{Prompt: "cat", Size: "1536x1024", Media: images}, `{"prompt":"cat","width":1536,"height":1024,"imageUrls":["https://media.example/a.png","https://media.example/b.png"]}`},
		{"image ratio and level", "rhart-image-n-pro/text-to-image", RunningHubInputs{Prompt: "cat", Size: "836x1254"}, `{"prompt":"cat","aspectRatio":"2:3","resolution":"1k"}`},
		{"image size list and count", "alibaba/qwen-image-2.0/text-to-image", RunningHubInputs{Prompt: "cat", Size: "1024x1536", Count: 2}, `{"prompt":"cat","size":"1024*1536","imageNum":"2"}`},
		{"video tool resolution", "rhart-video/video-upscaler", RunningHubInputs{Prompt: "ignored", Resolution: "2k", Media: map[string][]RunningHubMedia{"videos": {{URL: "https://media.example/a.mp4"}}}}, `{"videoUrl":"https://media.example/a.mp4","targetResolution":"2k"}`},
		{"music description", "rhart-audio/suno-v5/single", RunningHubInputs{Prompt: "calm piano"}, `{"description":"calm piano"}`},
		{"music cover audio", "minimax/music-cover", RunningHubInputs{Prompt: "jazz", Media: map[string][]RunningHubMedia{"audios": {{URL: "https://media.example/a.mp3"}}}}, `{"prompt":"jazz","audioUrl":"https://media.example/a.mp3"}`},
		{"speech defaults", "rhart-audio/text-to-audio/speech-2.6-hd", RunningHubInputs{Prompt: "你好", Speed: 3}, `{"text":"你好","voice_id":"Wise_Woman","speed":2,"enable_base64_output":false,"english_normalization":false}`},
		{"speech voice", "rhart-audio/text-to-audio/speech-2.6-hd", RunningHubInputs{Prompt: "hello", Voice: "Calm_Woman", Speed: 1.25}, `{"text":"hello","voice_id":"Calm_Woman","speed":1.25,"enable_base64_output":false,"english_normalization":false}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := BuildRunningHubPayload(test.endpoint, test.inputs)
			var gotValue, wantValue any
			if err != nil || json.Unmarshal(got, &gotValue) != nil || json.Unmarshal([]byte(test.want), &wantValue) != nil || !reflect.DeepEqual(gotValue, wantValue) {
				t.Fatalf("got %s, %v; want %s", got, err, test.want)
			}
		})
	}
	if _, err := BuildRunningHubPayload("kling-v3.0-pro/text-to-video", RunningHubInputs{Seconds: "5"}); err == nil || err.Error() != "请输入提示词" {
		t.Fatalf("missing prompt error = %v", err)
	}
}

func TestParseRunningHubTask(t *testing.T) {
	tests := []struct {
		name, payload, status, url, err string
		ok                              bool
	}{
		{"submitted", `{"taskId":"2013","status":"QUEUED","errorCode":"","errorMessage":""}`, "queued", "", "", true},
		{"created", `{"taskId":2013,"status":"CREATE"}`, "queued", "", "", true},
		{"running", `{"taskId":"2013","status":"RUNNING"}`, "processing", "", "", true},
		{"success", `{"taskId":"2013","status":"SUCCESS","results":[{"url":"https://cdn.example/a.mp4","outputType":"mp4"}]}`, "completed", "https://cdn.example/a.mp4", "", true},
		{"success without result", `{"taskId":"2013","status":"SUCCESS","results":[]}`, "failed", "", "RunningHub 任务完成但没有返回结果", true},
		{"failed", `{"taskId":"2013","status":"FAILED","errorCode":"1505","errorMessage":"Real person prohibited"}`, "failed", "", "Real person prohibited", true},
		{"cancelled", `{"taskId":"2013","status":"CANCEL"}`, "failed", "", "RunningHub 任务失败或已取消", true},
		{"error code only", `{"errorCode":1002}`, "failed", "", "RunningHub 错误码 1002", true},
		{"not a task", `{"data":[]}`, "queued", "", "", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			task, ok := ParseRunningHubTask([]byte(test.payload))
			if ok != test.ok || task.Status != test.status || task.Error != test.err || strings.Join(task.URLs, ",") != test.url || ok && task.TaskID != "2013" && test.name != "error code only" {
				t.Fatalf("got %+v, %v", task, ok)
			}
		})
	}
}

func TestRunningHubAudioURL(t *testing.T) {
	urls := []string{"https://cdn.example/cover.jpg", "https://cdn.example/song.mp3?sign=1"}
	if got := RunningHubAudioURL(urls); got != urls[1] {
		t.Fatalf("got %q", got)
	}
	if got := RunningHubAudioURL(urls[:1]); got != urls[0] {
		t.Fatalf("fallback got %q", got)
	}
}

func TestWaitRunningHubTaskPollsQuery(t *testing.T) {
	previousInterval, previousTransport := runningHubPollInterval, http.DefaultTransport
	t.Cleanup(func() { runningHubPollInterval, http.DefaultTransport = previousInterval, previousTransport })
	runningHubPollInterval = time.Millisecond
	calls := 0
	http.DefaultTransport = protocolAdminTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		body, _ := io.ReadAll(request.Body)
		if request.Method != http.MethodPost || request.URL.String() != "https://www.runninghub.cn/openapi/v2/query" || request.Header.Get("Authorization") != "Bearer test-key" || request.Header.Get("Content-Type") != "application/json" || string(body) != `{"taskId":"2013"}` {
			t.Errorf("unexpected query: %s %s %v %s", request.Method, request.URL, request.Header, body)
		}
		payload := `{"taskId":"2013","status":"RUNNING"}`
		if calls == 2 {
			payload = `{"taskId":"2013","status":"SUCCESS","results":[{"url":"https://cdn.example/a.png"},{"url":"https://cdn.example/b.png"}]}`
		}
		return protocolAdminResponse(payload), nil
	})
	channel := model.ModelChannel{Protocol: "runninghub", BaseURL: "https://www.runninghub.cn", APIKey: "test-key"}
	task, err := WaitRunningHubTask(channel, []byte(`{"taskId":"2013","status":"QUEUED"}`))
	if err != nil || calls != 2 || !reflect.DeepEqual(task.URLs, []string{"https://cdn.example/a.png", "https://cdn.example/b.png"}) {
		t.Fatalf("got %+v, %v after %d queries", task, err, calls)
	}
	for payload, want := range map[string]string{`{"taskId":"2013","status":"FAILED","errorMessage":"bad prompt"}`: "bad prompt", `{"errorCode":"412","errorMessage":"TOKEN_INVALID"}`: "TOKEN_INVALID", `not json`: "RunningHub 没有返回任务 ID"} {
		if _, err := WaitRunningHubTask(channel, []byte(payload)); err == nil || err.Error() != want || calls != 2 {
			t.Fatalf("%s: got %v after %d queries; want %q", payload, err, calls, want)
		}
	}
}

func TestUploadRunningHubMedia(t *testing.T) {
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = protocolAdminTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		mediaType, params, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
		part, err := multipart.NewReader(request.Body, params["boundary"]).NextPart()
		if err != nil {
			t.Errorf("upload is not multipart: %v", err)
			return nil, errors.New("invalid upload")
		}
		data, _ := io.ReadAll(part)
		if mediaType != "multipart/form-data" || request.URL.String() != "https://www.runninghub.ai/openapi/v2/media/upload/binary" || request.Header.Get("Authorization") != "Bearer test-key" || part.FormName() != "file" || part.FileName() != "upload.png" || part.Header.Get("Content-Type") != "image/png" || string(data) != "png" {
			t.Errorf("unexpected upload: %s %v %s %s", request.URL, request.Header, part.FileName(), data)
		}
		return protocolAdminResponse(`{"code":0,"data":{"download_url":"https://cdn.example/upload.png"}}`), nil
	})
	channel := model.ModelChannel{Protocol: "runninghub", BaseURL: "https://www.runninghub.ai/openapi/v2/", APIKey: "test-key"}
	if got, err := UploadRunningHubMedia(channel, RunningHubMedia{URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("png"))}); err != nil || got != "https://cdn.example/upload.png" {
		t.Fatalf("data URL upload got %q, %v", got, err)
	}
	if got, err := UploadRunningHubMedia(channel, RunningHubMedia{URL: " https://media.example/a.png "}); err != nil || got != "https://media.example/a.png" {
		t.Fatalf("public URL got %q, %v", got, err)
	}
	if _, err := UploadRunningHubMedia(channel, RunningHubMedia{URL: "blob:local"}); err == nil || calls != 1 {
		t.Fatalf("blob URL got %v after %d uploads", err, calls)
	}
}
