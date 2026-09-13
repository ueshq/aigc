package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

// runningHubMediaFields maps OpenAI-shaped media form fields and chat content part types to RunningHub input roles.
var runningHubMediaFields = map[string]string{
	"first_frame_url":   "first",
	"last_frame_url":    "last",
	"input_reference[]": "images",
	"image":             "images",
	"image[]":           "images",
	"image_url":         "images",
	"video_reference[]": "videos",
	"video_url":         "videos",
	"audio_reference[]": "audios",
	"audio_url":         "audios",
}

func isRunningHubTaskEndpoint(endpoint string) bool {
	switch endpoint {
	case "/videos", "/images/generations", "/images/edits", "/audio/speech", "/chat/completions":
		return true
	}
	return false
}

// prepareRunningHubRequest turns an OpenAI-shaped chat, image, speech or video request into the JSON body and path of the matching RunningHub endpoint.
func prepareRunningHubRequest(input aiProtocolRequest) ([]byte, string, error) {
	inputs, err := readRunningHubInputs(input.body, input.contentType)
	if err != nil {
		return nil, "", err
	}
	lipSync := strings.TrimSpace(input.modelName) == service.RunningHubLipSyncModel
	endpoint := "kling-lip-sync/lip-sync-video"
	if !lipSync {
		if endpoint, err = service.SelectRunningHubEndpoint(input.modelName, inputs.Media); err != nil {
			return nil, "", err
		}
	}
	for _, items := range inputs.Media {
		for index := range items {
			if items[index].URL, err = service.UploadRunningHubMedia(input.channel, items[index]); err != nil {
				return nil, "", err
			}
		}
	}
	var body []byte
	if lipSync {
		body, err = service.PrepareRunningHubLipSync(input.channel, inputs)
	} else {
		body, err = service.BuildRunningHubPayload(endpoint, inputs)
	}
	return body, "/" + endpoint, err
}

// readRunningHubInputs reads JSON chat/image/speech bodies and multipart edit/video forms, keeping media in request order.
func readRunningHubInputs(body []byte, contentType string) (service.RunningHubInputs, error) {
	inputs := service.RunningHubInputs{Media: map[string][]service.RunningHubMedia{}}
	invalid := errors.New("RunningHub 请求格式无效")
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		var request struct {
			Prompt          string          `json:"prompt"`
			Input           string          `json:"input"`
			Size            string          `json:"size"`
			Quality         string          `json:"quality"`
			Voice           string          `json:"voice"`
			ReferenceAudio  string          `json:"reference_audio"`
			N               int             `json:"n"`
			Speed           float64         `json:"speed"`
			AudioDurationMs int             `json:"audio_duration_ms"`
			ExtraParams     json.RawMessage `json:"extra_params"`
			Messages        []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if json.Unmarshal(body, &request) != nil {
			return inputs, invalid
		}
		inputs.Prompt, inputs.Size, inputs.Quality, inputs.Voice, inputs.Count, inputs.Speed = firstNonEmpty(request.Prompt, request.Input), request.Size, request.Quality, request.Voice, request.N, request.Speed
		inputs.AudioDurationMs, inputs.Extra = request.AudioDurationMs, readRunningHubExtra(request.ExtraParams)
		if audio := strings.TrimSpace(request.ReferenceAudio); audio != "" {
			inputs.Media["audios"] = []service.RunningHubMedia{{URL: audio}}
		}
		// Chat messages: every text part joins the prompt; image, video, audio and frame parts become media.
		texts := []string{}
		for _, message := range request.Messages {
			var text string
			if json.Unmarshal(message.Content, &text) == nil {
				texts = append(texts, strings.TrimSpace(text))
				continue
			}
			var parts []map[string]any
			_ = json.Unmarshal(message.Content, &parts)
			for _, part := range parts {
				kind, _ := part["type"].(string)
				if text, ok := part["text"].(string); kind == "text" && ok {
					texts = append(texts, strings.TrimSpace(text))
				} else if media, ok := part[kind].(map[string]any); ok && runningHubMediaFields[kind] != "" {
					if url, _ := media["url"].(string); strings.TrimSpace(url) != "" {
						inputs.Media[runningHubMediaFields[kind]] = append(inputs.Media[runningHubMediaFields[kind]], service.RunningHubMedia{URL: strings.TrimSpace(url)})
					}
				}
			}
		}
		if prompt := strings.TrimSpace(strings.Join(texts, "\n\n")); prompt != "" {
			inputs.Prompt = prompt
		}
		return inputs, nil
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return inputs, invalid
	}
	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	values := map[string]string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return inputs, invalid
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return inputs, invalid
		}
		role, media := runningHubMediaFields[part.FormName()]
		switch {
		case media && part.FileName() != "":
			inputs.Media[role] = append(inputs.Media[role], service.RunningHubMedia{Data: data, Filename: part.FileName(), ContentType: part.Header.Get("Content-Type")})
		case media && strings.TrimSpace(string(data)) != "":
			inputs.Media[role] = append(inputs.Media[role], service.RunningHubMedia{URL: strings.TrimSpace(string(data))})
		case !media:
			values[part.FormName()] = strings.TrimSpace(string(data))
		}
	}
	inputs.Count, _ = strconv.Atoi(values["n"])
	inputs.AudioDurationMs, _ = strconv.Atoi(values["audio_duration_ms"])
	inputs.Prompt, inputs.Size, inputs.Quality = values["prompt"], values["size"], values["quality"]
	inputs.Seconds, inputs.Resolution, inputs.GenerateAudio = values["seconds"], values["resolution_name"], values["video_generate_audio"]
	inputs.Extra = readRunningHubExtra([]byte(values["extra_params"]))
	return inputs, nil
}

// readRunningHubExtra reads advanced parameters sent as a JSON object or as a JSON-encoded string.
func readRunningHubExtra(raw []byte) map[string]any {
	var extra map[string]any
	if json.Unmarshal(raw, &extra) != nil {
		var text string
		if json.Unmarshal(raw, &text) == nil {
			_ = json.Unmarshal([]byte(text), &extra)
		}
	}
	return extra
}

// completeRunningHubTask waits for an async RunningHub chat, image or speech task and writes the OpenAI-shaped result.
func completeRunningHubTask(w http.ResponseWriter, response *http.Response, channel model.ModelChannel, logContext aiLogContext, onFailure func()) bool {
	if !service.IsRunningHubChannel(channel) || logContext.Endpoint == "/videos" || !isRunningHubTaskEndpoint(logContext.Endpoint) {
		return false
	}
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	task, err := service.WaitRunningHubTask(channel, payload)
	body, contentType, responseLog := []byte(nil), "application/json", string(task.Raw)
	switch {
	case err != nil:
	case logContext.Endpoint == "/audio/speech" && len(task.URLs) == 0:
		err = errors.New("RunningHub 没有返回音频")
	case logContext.Endpoint == "/audio/speech":
		body, contentType, err = service.DownloadRunningHubResult(service.RunningHubResultURL(task.URLs, "audio"))
		responseLog = "[binary audio]"
	case logContext.Endpoint == "/chat/completions":
		message := map[string]string{"role": "assistant", "content": firstNonEmpty(task.Text, strings.Join(task.URLs, "\n"))}
		body, _ = json.Marshal(map[string]any{"id": "chatcmpl-" + task.TaskID, "object": "chat.completion", "created": time.Now().Unix(), "model": logContext.Model, "choices": []map[string]any{{"index": 0, "message": message, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})
	default:
		data := make([]map[string]string, len(task.URLs))
		for index, url := range task.URLs {
			data[index] = map[string]string{"url": url}
		}
		body, _ = json.Marshal(map[string]any{"created": time.Now().Unix(), "data": data})
	}
	if err != nil {
		if onFailure != nil {
			onFailure()
		}
		saveAIProxyLog(logContext, response.StatusCode, firstNonEmpty(string(task.Raw), string(payload)), err.Error())
		Fail(w, err.Error())
		return true
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
	saveAIProxyLog(logContext, http.StatusOK, responseLog, "")
	return true
}

// transformRunningHubVideoTaskResponse maps submit and query responses onto the shared video task fields; 3D families
// store their model file as the task result.
func transformRunningHubVideoTaskResponse(payload []byte, modelName string) ([]byte, bool) {
	task, ok := service.ParseRunningHubTask(payload)
	if !ok {
		return nil, false
	}
	result := map[string]any{"task_id": task.TaskID, "status": task.Status}
	if len(task.URLs) > 0 {
		kind := ""
		if strings.HasSuffix(strings.TrimSpace(modelName), "/model3d") {
			kind = "model3d"
		}
		result["video_url"] = service.RunningHubResultURL(task.URLs, kind)
	}
	if task.Error != "" {
		result["error"] = map[string]string{"message": task.Error}
	}
	encoded, err := json.Marshal(result)
	return encoded, err == nil
}
