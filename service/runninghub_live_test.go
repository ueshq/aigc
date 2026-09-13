package service

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"github.com/tigerowo/infinite-canvas/model"
)

// TestRunningHubLive spends a small RunningHub balance on one cheap request per capability, reading .env/runninghub.env.
// Run explicitly: RUNNINGHUB_LIVE=1 go test ./service -run TestRunningHubLive -v -count=1 -timeout 40m
func TestRunningHubLive(t *testing.T) {
	if os.Getenv("RUNNINGHUB_LIVE") != "1" {
		t.Skip("set RUNNINGHUB_LIVE=1 to run paid RunningHub checks")
	}
	env, err := godotenv.Read("../.env/runninghub.env")
	if err != nil || env["RUNNINGHUB_API_KEY"] == "" {
		t.Skip("missing .env/runninghub.env")
	}
	channel := model.ModelChannel{Protocol: ModelChannelProtocolRunningHub, BaseURL: env["RUNNINGHUB_BASE_URL"], APIKey: env["RUNNINGHUB_API_KEY"], Timeout: 1200}
	generate := func(t *testing.T, modelName string, inputs RunningHubInputs) RunningHubTask {
		t.Helper()
		endpoint, err := SelectRunningHubEndpoint(modelName, inputs.Media)
		if err != nil {
			t.Fatalf("select %s: %v", modelName, err)
		}
		for _, items := range inputs.Media {
			for index := range items {
				if items[index].URL, err = UploadRunningHubMedia(channel, items[index]); err != nil {
					t.Fatalf("upload: %v", err)
				}
			}
		}
		body, err := BuildRunningHubPayload(endpoint, inputs)
		if err != nil {
			t.Fatalf("payload: %v", err)
		}
		t.Logf("POST /%s %s", endpoint, body)
		request, _ := http.NewRequest(http.MethodPost, BuildModelChannelURL(channel, "/"+endpoint), bytes.NewReader(body))
		SetModelChannelAuthHeader(request, channel)
		request.Header.Set("Content-Type", "application/json")
		started := time.Now()
		response, err := HTTPClientForChannel(channel).Do(request)
		if err != nil {
			t.Fatalf("submit: %v", err)
		}
		payload, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode >= http.StatusBadRequest {
			t.Fatalf("submit HTTP %d: %s", response.StatusCode, payload)
		}
		task, err := WaitRunningHubTask(channel, payload)
		raw := string(task.Raw)
		t.Logf("task %s %s after %s, urls=%v, final=%s", task.TaskID, task.Status, time.Since(started).Round(time.Second), task.URLs, raw[:min(len(raw), 1500)])
		if err != nil {
			t.Fatalf("task: %v", err)
		}
		return task
	}

	t.Run("capabilities", func(t *testing.T) {
		t.Run("image and frames", func(t *testing.T) {
			t.Parallel()
			var imageURL string
			t.Run("text to image", func(t *testing.T) {
				imageURL = generate(t, "rhart-image-v1/image", RunningHubInputs{Prompt: "a single red apple on a plain white table, studio photo", Size: "1024x1024"}).URLs[0]
			})
			t.Run("edit uploaded image", func(t *testing.T) {
				canvas := image.NewRGBA(image.Rect(0, 0, 512, 512))
				draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: color.RGBA{R: 40, G: 90, B: 200, A: 255}}, image.Point{}, draw.Src)
				var buffer bytes.Buffer
				if err := png.Encode(&buffer, canvas); err != nil {
					t.Fatal(err)
				}
				generate(t, "rhart-image-v1/image", RunningHubInputs{Prompt: "draw a small yellow star in the center", Media: map[string][]RunningHubMedia{"images": {{Data: buffer.Bytes(), Filename: "blue.png", ContentType: "image/png"}}}})
			})
			t.Run("first and last frames", func(t *testing.T) {
				if imageURL == "" {
					t.Skip("text to image failed")
				}
				frame := []RunningHubMedia{{URL: imageURL}}
				generate(t, "vidu/q2-turbo/video", RunningHubInputs{Prompt: "the apple slowly turns", Seconds: "1", Resolution: "540p", Media: map[string][]RunningHubMedia{"first": frame, "last": frame}})
			})
		})
		t.Run("video and tool", func(t *testing.T) {
			t.Parallel()
			var videoURL string
			t.Run("text to video", func(t *testing.T) {
				videoURL = generate(t, "rhart-video-g/video", RunningHubInputs{Prompt: "a paper boat drifting on a calm lake", Seconds: "6", Size: "16:9", Resolution: "480p"}).URLs[0]
			})
			t.Run("subtitle erase", func(t *testing.T) {
				if videoURL == "" {
					t.Skip("text to video failed")
				}
				generate(t, "volc-subtitle-erase/video", RunningHubInputs{Media: map[string][]RunningHubMedia{"videos": {{URL: videoURL}}}})
			})
		})
		t.Run("speech", func(t *testing.T) {
			t.Parallel()
			task := generate(t, "minimax/speech-02-turbo/tts", RunningHubInputs{Prompt: "你好，RunningHub。", Speed: 1})
			audio, contentType, err := DownloadRunningHubResult(task.URLs[0])
			if err != nil || len(audio) == 0 {
				t.Fatalf("download audio: %d bytes, %v", len(audio), err)
			}
			t.Logf("audio %s, %d bytes", contentType, len(audio))
		})
		t.Run("music", func(t *testing.T) {
			t.Parallel()
			generate(t, "suno-v5/single/music", RunningHubInputs{Prompt: "a short calm solo piano melody, instrumental"})
		})
	})
}
