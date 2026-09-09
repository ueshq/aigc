package service

import (
	"encoding/json"
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
