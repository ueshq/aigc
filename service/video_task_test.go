package service

import (
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestVideoTaskPollDue(t *testing.T) {
	at := time.Now()
	polled := func(ago time.Duration) string { return videoTaskTime(at.Add(-ago)) }
	for _, test := range []struct {
		name string
		task model.VideoTask
		want bool
	}{
		{"other models poll every tick", model.VideoTask{Model: "doubao-seedance-2", LastPolledAt: polled(time.Second)}, true},
		{"MiniMax first poll", model.VideoTask{Model: "MiniMax-H3"}, true},
		{"MiniMax skips one tick", model.VideoTask{Model: "MiniMax-H3-Max", LastPolledAt: polled(5 * time.Second)}, false},
		{"MiniMax polls on the ten-second tick", model.VideoTask{Model: "MiniMax-H3", LastPolledAt: polled(8 * time.Second)}, true},
		{"MiniMax regeneration uses the same interval", model.VideoTask{Model: MiniMaxRegenerationModel, LastPolledAt: polled(5 * time.Second)}, false},
	} {
		if got := videoTaskPollDue(test.task, at); got != test.want {
			t.Errorf("%s: got %v, want %v", test.name, got, test.want)
		}
	}
}
