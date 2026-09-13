package service

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestMiniMaxVideoRequestValidation(t *testing.T) {
	for _, name := range MiniMaxModels() {
		if !isVideoModelName(name) || isTextModelName(name) {
			t.Fatalf("MiniMax video model classified incorrectly: %s", name)
		}
	}
	text := map[string]any{"type": "text", "text": "scene"}
	frame := map[string]any{"type": "image_url", "role": "first_frame"}
	last := map[string]any{"type": "image_url", "role": "last_frame"}
	image := map[string]any{"type": "image_url", "role": "reference_image"}
	audio := map[string]any{"type": "audio_url", "role": "reference_audio"}
	for _, test := range []struct {
		name, model, resolution, ratio string
		duration int
		content []map[string]any
		invalid bool
	}{
		{"H3 minimum", "MiniMax-H3", "768P", "16:9", 4, []map[string]any{text}, false},
		{"H3 maximum", "MiniMax-H3", "2K", "21:9", 15, []map[string]any{text}, false},
		{"Max minimum", "MiniMax-H3-Max", "480P", "9:16", 5, []map[string]any{text}, false},
		{"Max maximum", "MiniMax-H3-Max", "768P", "16:9", 15, []map[string]any{text}, false},
		{"Max 2K", "MiniMax-H3-Max", "2K", "16:9", 5, []map[string]any{text}, true},
		{"Max four seconds", "MiniMax-H3-Max", "768P", "16:9", 4, []map[string]any{text}, true},
		{"too long", "MiniMax-H3", "768P", "16:9", 16, []map[string]any{text}, true},
		{"first frame", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text, frame}, false},
		{"paired frames", "MiniMax-H3-Max", "768P", "adaptive", 5, []map[string]any{text, frame, last}, false},
		{"last only", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text, last}, true},
		{"mixed modes", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text, frame, image}, true},
		{"Max references", "MiniMax-H3-Max", "768P", "adaptive", 5, []map[string]any{text, image}, true},
		{"audio alone", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text, audio}, false},
		{"too many audios", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text, audio, audio, audio, audio}, true},
		{"missing text", "MiniMax-H3", "768P", "16:9", 5, nil, true},
		{"long text", "MiniMax-H3", "768P", "16:9", 5, []map[string]any{{"type": "text", "text": strings.Repeat("字", 7001)}}, true},
		{"adaptive text", "MiniMax-H3", "768P", "adaptive", 5, []map[string]any{text}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{"model": test.model, "resolution": test.resolution, "ratio": test.ratio, "duration": test.duration, "content": test.content})
			if err != nil { t.Fatal(err) }
			if err := ValidateMiniMaxVideoRequest(body); (err != nil) != test.invalid { t.Fatalf("unexpected validation: %v", err) }
		})
	}
	if ValidateMiniMaxVideoRequest(make([]byte, 64*1024*1024+1)) == nil { t.Fatal("oversized request accepted") }
}

func TestMiniMaxContextIRAndRegenerationRequests(t *testing.T) {
	text := map[string]any{"type": "text", "text": "scene"}
	frame := map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://media.example/frame.png"}, "role": "first_frame"}
	image := map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://media.example/image.png"}, "role": "reference_image"}
	base := map[string]any{"type": "video_url", "video_url": map[string]any{"url": "https://media.example/base.mp4"}, "role": "base_video"}
	for _, test := range []struct {
		name, model string
		body        map[string]any
		invalid     bool
	}{
		{"context text", MiniMaxContextIRModel, map[string]any{"content": []any{text}, "duration": 4, "ratio": "16:9"}, false},
		{"context frames", MiniMaxContextIRModel, map[string]any{"content": []any{text, frame}, "duration": 15, "ratio": "adaptive"}, false},
		{"context references", MiniMaxContextIRModel, map[string]any{"content": []any{text, image}, "duration": 5}, false},
		{"context short", MiniMaxContextIRModel, map[string]any{"content": []any{text}, "duration": 3, "ratio": "16:9"}, true},
		{"context adaptive text", MiniMaxContextIRModel, map[string]any{"content": []any{text}, "duration": 5, "ratio": "adaptive"}, true},
		{"context mixed modes", MiniMaxContextIRModel, map[string]any{"content": []any{text, frame, image}, "duration": 5}, true},
		{"context base video", MiniMaxContextIRModel, map[string]any{"content": []any{text, base}, "duration": 5}, true},
		{"regeneration", MiniMaxRegenerationModel, map[string]any{"content": []any{text, base}, "resolution": "2K", "aigc_watermark": true}, false},
		{"regeneration with frame", MiniMaxRegenerationModel, map[string]any{"content": []any{text, frame, base}, "resolution": "2K"}, false},
		{"regeneration missing base", MiniMaxRegenerationModel, map[string]any{"content": []any{text}, "resolution": "2K"}, true},
		{"regeneration two bases", MiniMaxRegenerationModel, map[string]any{"content": []any{text, base, base}, "resolution": "2K"}, true},
		{"regeneration 768P", MiniMaxRegenerationModel, map[string]any{"content": []any{text, base}, "resolution": "768P"}, true},
		{"regeneration missing text", MiniMaxRegenerationModel, map[string]any{"content": []any{base}, "resolution": "2K"}, true},
		{"generation watermark", "MiniMax-H3", map[string]any{"content": []any{text}, "resolution": "768P", "duration": 5, "ratio": "16:9", "aigc_watermark": true}, false},
		{"generation base video", "MiniMax-H3", map[string]any{"content": []any{text, base}, "resolution": "768P", "duration": 5, "ratio": "16:9"}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.body["model"] = test.model
			body, err := json.Marshal(test.body)
			if err != nil {
				t.Fatal(err)
			}
			prepared, err := PrepareMiniMaxVideoRequest(test.model, body)
			if (err != nil) != test.invalid {
				t.Fatalf("unexpected validation: %v", err)
			}
			if err != nil {
				return
			}
			test.body["model"] = MiniMaxChannelModelName(test.model)
			want, _ := json.Marshal(test.body)
			var got, expected any
			if json.Unmarshal(prepared, &got) != nil || json.Unmarshal(want, &expected) != nil || !reflect.DeepEqual(got, expected) {
				t.Fatalf("prepared %s, want %s", prepared, want)
			}
		})
	}
	if MiniMaxChannelModelName(MiniMaxRegenerationModel) != "MiniMax-H3" || MiniMaxChannelModelName("MiniMax-H3-Max") != "MiniMax-H3-Max" || MiniMaxCreatePath(MiniMaxContextIRModel) != "/v2/h3_context_ir" || MiniMaxCreatePath(MiniMaxRegenerationModel) != "/v2/video_regeneration" || MiniMaxCreatePath("MiniMax-H3") != "/v2/video_generation" {
		t.Fatal("internal MiniMax task models route incorrectly")
	}
}
