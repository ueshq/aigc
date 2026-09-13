package service

import (
	"net/http"
	"sort"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

const ModelChannelProtocolOpenAI = "openai"

func BuildModelChannelURL(channel model.ModelChannel, path string) string {
	switch strings.ToLower(strings.TrimSpace(channel.Protocol)) {
	case ModelChannelProtocolGemini:
		return BuildGeminiChannelURL(channel, path)
	case ModelChannelProtocolMiniMax:
		return normalizeModelChannelBaseURL(channel.BaseURL) + path
	case ModelChannelProtocolRunningHub:
		return runningHubBaseURL(channel) + path
	default:
		return buildOpenAIModelChannelURL(channel, path)
	}
}

func SetModelChannelAuthHeader(request *http.Request, channel model.ModelChannel) {
	if IsGeminiChannel(channel) {
		request.Header.Set("x-goog-api-key", channel.APIKey)
	} else {
		request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	}
}

func fetchAdminChannelModels(channel model.ModelChannel) ([]string, error) {
	switch {
	case IsGeminiChannel(channel):
		return fetchGeminiAdminChannelModels(channel)
	case IsMiniMaxChannel(channel):
		return MiniMaxModels(), nil
	case IsRunningHubChannel(channel):
		return RunningHubModels(), nil
	case IsMiMoChannel(channel):
		result := MiMoModels()
		sort.Strings(result)
		return result, nil
	default:
		return fetchOpenAIAdminChannelModels(channel)
	}
}
