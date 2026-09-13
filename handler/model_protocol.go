package handler

import (
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

type aiProtocolRequestMode uint8

const (
	aiProtocolProxyRequest aiProtocolRequestMode = iota
	aiProtocolVideoRequest
)

type aiProtocolRequest struct {
	mode         aiProtocolRequestMode
	body         []byte
	contentType  string
	modelName    string
	channel      model.ModelChannel
	endpoint     string
	path         string
	failureLabel string
}

func prepareAIProtocolRequest(input aiProtocolRequest) (aiProtocolRequest, error) {
	if service.IsGeminiChannel(input.channel) {
		input.failureLabel = "Gemini"
		if input.mode == aiProtocolProxyRequest && input.endpoint == "/chat/completions" && !geminiStreamRequested(input.body) {
			input.path = service.GeminiModelActionPath(input.modelName, "generateContent")
		}
		var err error
		input.body, err = service.StripGeminiModelField(input.body, input.contentType)
		if err != nil || input.mode == aiProtocolVideoRequest {
			return input, err
		}
	}
	if input.mode == aiProtocolProxyRequest && service.IsMiMoTTSModelName(input.modelName) && input.endpoint == "/audio/speech" {
		input.failureLabel = "MiMo TTS"
		var err error
		input.body, input.contentType, err = normalizeMiMoTTSBody(input.body, input.contentType, input.modelName)
		return input, err
	}
	if isMiniMaxH3Channel(input.channel, input.modelName) && input.endpoint == "/videos" {
		input.failureLabel = "MiniMax"
		var err error
		input.body, err = service.PrepareMiniMaxVideoRequest(input.modelName, input.body)
		return input, err
	}
	return input, nil
}

func resolveAIProxyPath(channel model.ModelChannel, modelName string, path string) string {
	if service.IsGeminiChannel(channel) {
		switch path {
		case "/chat/completions":
			return service.GeminiModelActionPath(modelName, "streamGenerateContent") + "?alt=sse"
		case "/images/generations", "/images/edits", "/audio/speech":
			return service.GeminiModelActionPath(modelName, "generateContent")
		case "/videos":
			return service.GeminiModelActionPath(modelName, "predictLongRunning")
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			return service.GeminiOperationPath(strings.TrimPrefix(path, "/videos/"))
		}
	}
	if service.IsMiMoTTSModelName(modelName) && path == "/audio/speech" {
		return "/chat/completions"
	}
	if isMiniMaxH3Channel(channel, modelName) || isCogVideoX3Model(modelName) {
		createPath, queryPath := "/videos/generations", "/async-result/"
		if isMiniMaxH3Channel(channel, modelName) {
			createPath, queryPath = service.MiniMaxCreatePath(modelName), "/v2/query/video_generation/"
		}
		if path == "/videos" {
			return createPath
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			taskID := strings.TrimSpace(strings.TrimPrefix(path, "/videos/"))
			if taskID != "" && !strings.Contains(taskID, "/") {
				return queryPath + url.PathEscape(taskID)
			}
		}
		return path
	}
	if service.IsArkChannel(channel) {
		if path == "/videos" {
			return "/contents/generations/tasks"
		}
		if strings.HasPrefix(path, "/videos/") && !strings.HasSuffix(path, "/content") {
			return "/contents/generations/tasks/" + strings.TrimPrefix(path, "/videos/")
		}
	}
	return path
}

func resolveAIProxyURL(channel model.ModelChannel, modelName string, path string) string {
	videoID, ok := agnesVideoQueryID(modelName, path)
	if !ok {
		return service.BuildModelChannelURL(channel, path)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
	if strings.HasSuffix(strings.ToLower(baseURL), "/v1") {
		baseURL = strings.TrimRight(baseURL[:len(baseURL)-len("/v1")], "/")
	}
	values := url.Values{}
	values.Set("video_id", videoID)
	values.Set("model_name", modelName)
	return baseURL + "/agnesapi?" + values.Encode()
}

func isMiniMaxH3Channel(channel model.ModelChannel, modelName string) bool {
	return service.IsMiniMaxChannel(channel) && service.IsMiniMaxTaskModelName(modelName)
}
