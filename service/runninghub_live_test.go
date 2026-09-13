package service

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"github.com/tigerowo/infinite-canvas/model"
)

// TestRunningHubLive spends a small RunningHub balance on one cheap request per capability, reading .env/runninghub.env.
// Run explicitly: RUNNINGHUB_LIVE=1 go test ./service -run TestRunningHubLive -v -count=1 -timeout 40m
// Groups can run alone, e.g. -run TestRunningHubLive/extended. Voice clone and design are never run here.
func TestRunningHubLive(t *testing.T) {
	if os.Getenv("RUNNINGHUB_LIVE") != "1" {
		t.Skip("set RUNNINGHUB_LIVE=1 to run paid RunningHub checks")
	}
	env, err := godotenv.Read("../.env/runninghub.env")
	if err != nil || env["RUNNINGHUB_API_KEY"] == "" {
		t.Skip("missing .env/runninghub.env")
	}
	channel := model.ModelChannel{Protocol: ModelChannelProtocolRunningHub, BaseURL: env["RUNNINGHUB_BASE_URL"], APIKey: env["RUNNINGHUB_API_KEY"], Timeout: 1200}
	submit := func(t *testing.T, endpoint string, body []byte) RunningHubTask {
		t.Helper()
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
		t.Logf("task %s %s after %s, urls=%v, text=%q, final=%s", task.TaskID, task.Status, time.Since(started).Round(time.Second), task.URLs, task.Text[:min(len(task.Text), 300)], raw[:min(len(raw), 1500)])
		if err != nil {
			t.Fatalf("task: %v", err)
		}
		return task
	}
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
		return submit(t, endpoint, body)
	}
	// A shaded red sphere on white works both as an image to describe and as a single view for image-to-3D.
	sphere := func() RunningHubMedia {
		canvas := image.NewRGBA(image.Rect(0, 0, 512, 512))
		for y := range 512 {
			for x := range 512 {
				dx, dy := float64(x-256)/180, float64(y-256)/180
				if distance := dx*dx + dy*dy; distance <= 1 {
					light := 0.3 + 0.7*math.Max(0, -0.4*dx-0.5*dy+0.77*math.Sqrt(1-distance))
					canvas.Set(x, y, color.RGBA{R: uint8(230 * light), G: uint8(40 * light), B: uint8(40 * light), A: 255})
				} else {
					canvas.Set(x, y, color.White)
				}
			}
		}
		var buffer bytes.Buffer
		_ = png.Encode(&buffer, canvas)
		return RunningHubMedia{Data: buffer.Bytes(), Filename: "sphere.png", ContentType: "image/png"}
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

	t.Run("extended", func(t *testing.T) {
		t.Run("text", func(t *testing.T) {
			t.Parallel()
			t.Run("lyrics", func(t *testing.T) {
				if task := generate(t, "suno/lyrics/text", RunningHubInputs{Prompt: "a short cheerful song about morning coffee"}); task.Text == "" && len(task.URLs) == 0 {
					t.Fatal("lyrics returned nothing")
				}
			})
			t.Run("image understanding", func(t *testing.T) {
				task := generate(t, "rhart-text-g-25-flash/text", RunningHubInputs{Prompt: "What object and color are in this image? Answer in one short sentence.", Media: map[string][]RunningHubMedia{"images": {sphere()}}})
				if task.Text == "" {
					t.Fatal("image understanding returned no text")
				}
			})
		})
		t.Run("music params", func(t *testing.T) {
			t.Parallel()
			audio := func(t *testing.T, task RunningHubTask) {
				t.Helper()
				if url := RunningHubResultURL(task.URLs, "audio"); url == "" {
					t.Fatal("music returned no audio")
				} else {
					t.Logf("audio result %s", url)
				}
			}
			t.Run("mureka bgm", func(t *testing.T) {
				audio(t, generate(t, "mureka-v9/generate-bgm/music", RunningHubInputs{Prompt: "calm lofi beat for studying", Extra: map[string]any{"n": 1}}))
			})
			t.Run("suno custom", func(t *testing.T) {
				audio(t, generate(t, "suno-v5/custom/music", RunningHubInputs{Prompt: "[Verse]\nMorning light and a cup of coffee\n[Chorus]\nHello, hello, a brand new day", Extra: map[string]any{"title": "Morning Coffee", "tags": "acoustic pop"}}))
			})
		})
		t.Run("model3d", func(t *testing.T) {
			t.Parallel()
			task := generate(t, "hitem3d-v15/model3d", RunningHubInputs{Extra: map[string]any{"resolution": "512", "requestType": "mesh"}, Media: map[string][]RunningHubMedia{"images": {sphere()}}})
			url := RunningHubResultURL(task.URLs, "model3d")
			if !strings.Contains(strings.ToLower(url), ".glb") && !strings.Contains(strings.ToLower(url), ".obj") && !strings.Contains(strings.ToLower(url), ".fbx") {
				t.Fatalf("3D result %q is not a model file", url)
			}
			t.Logf("model result %s", url)
		})
		t.Run("lip sync", func(t *testing.T) {
			t.Parallel()
			// RUNNINGHUB_LIP_SYNC_VIDEO reuses a 720p face video from an earlier run instead of paying for a new one.
			videoURL := os.Getenv("RUNNINGHUB_LIP_SYNC_VIDEO")
			if videoURL == "" {
				videoURL = generate(t, "rhart-video-v3.1-lite/video", RunningHubInputs{Prompt: "close-up portrait of a friendly young woman facing the camera and talking, plain studio background, steady camera", Seconds: "4", Size: "16:9", Resolution: "720p"}).URLs[0]
			}
			media := map[string][]RunningHubMedia{"videos": {{URL: videoURL}}}
			const speechText = "你好，欢迎来到无限画布，今天我们一起用画布创作一段短片。"
			body, err := PrepareRunningHubLipSync(channel, RunningHubInputs{Prompt: speechText, Media: media})
			if err != nil {
				// Log the raw helper results so a response-shape mismatch can be fixed.
				face, faceErr := runRunningHubTask(channel, "kling-lip-sync/identify-face", RunningHubInputs{Media: media})
				t.Logf("identify-face raw=%s err=%v", face.Raw, faceErr)
				if faceErr == nil && runningHubTaskFacts(face)["faceid"] != "" {
					speech, speechErr := runRunningHubTask(channel, "kling-lip-sync/tts", RunningHubInputs{Prompt: speechText})
					t.Logf("tts raw=%s err=%v", speech.Raw, speechErr)
				}
				t.Fatalf("prepare lip sync: %v", err)
			}
			submit(t, "kling-lip-sync/lip-sync-video", body)
		})
	})
}
