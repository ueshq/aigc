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

// runningHubMediaFields maps the OpenAI-shaped media form fields to RunningHub input roles.
var runningHubMediaFields = map[string]string{
	"first_frame_url":   "first",
	"last_frame_url":    "last",
	"input_reference[]": "images",
	"image":             "images",
	"image[]":           "images",
	"video_reference[]": "videos",
	"audio_reference[]": "audios",
}

func isRunningHubTaskEndpoint(endpoint string) bool {
	return endpoint == "/videos" || endpoint == "/images/generations" || endpoint == "/images/edits" || endpoint == "/audio/speech"
}

// prepareRunningHubRequest turns an OpenAI-shaped image, speech or video request into the JSON body and path of the matching RunningHub endpoint.
func prepareRunningHubRequest(input aiProtocolRequest) ([]byte, string, error) {
	inputs, err := readRunningHubInputs(input.body, input.contentType)
	if err != nil {
		return nil, "", err
	}
	endpoint, err := service.SelectRunningHubEndpoint(input.modelName, inputs.Media)
	if err != nil {
		return nil, "", err
	}
	for _, items := range inputs.Media {
		for index := range items {
			if items[index].URL, err = service.UploadRunningHubMedia(input.channel, items[index]); err != nil {
				return nil, "", err
			}
		}
	}
	body, err := service.BuildRunningHubPayload(endpoint, inputs)
	return body, "/" + endpoint, err
}

// readRunningHubInputs reads JSON image/speech bodies and multipart edit/video forms, keeping media parts in request order.
func readRunningHubInputs(body []byte, contentType string) (service.RunningHubInputs, error) {
	inputs := service.RunningHubInputs{Media: map[string][]service.RunningHubMedia{}}
	invalid := errors.New("RunningHub 请求格式无效")
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		var request struct {
			Prompt         string  `json:"prompt"`
			Input          string  `json:"input"`
			Size           string  `json:"size"`
			Quality        string  `json:"quality"`
			Voice          string  `json:"voice"`
			ReferenceAudio string  `json:"reference_audio"`
			N              int     `json:"n"`
			Speed          float64 `json:"speed"`
		}
		if json.Unmarshal(body, &request) != nil {
			return inputs, invalid
		}
		inputs.Prompt, inputs.Size, inputs.Quality, inputs.Voice, inputs.Count, inputs.Speed = firstNonEmpty(request.Prompt, request.Input), request.Size, request.Quality, request.Voice, request.N, request.Speed
		if audio := strings.TrimSpace(request.ReferenceAudio); audio != "" {
			inputs.Media["audios"] = []service.RunningHubMedia{{URL: audio}}
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
	inputs.Prompt, inputs.Size, inputs.Quality = values["prompt"], values["size"], values["quality"]
	inputs.Seconds, inputs.Resolution, inputs.GenerateAudio = values["seconds"], values["resolution_name"], values["video_generate_audio"]
	return inputs, nil
}

// completeRunningHubTask waits for an async RunningHub image or speech task and writes the OpenAI-shaped result.
func completeRunningHubTask(w http.ResponseWriter, response *http.Response, channel model.ModelChannel, logContext aiLogContext, onFailure func()) bool {
	if !service.IsRunningHubChannel(channel) || logContext.Endpoint == "/videos" || !isRunningHubTaskEndpoint(logContext.Endpoint) {
		return false
	}
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	task, err := service.WaitRunningHubTask(channel, payload)
	body, contentType := []byte(nil), "application/json"
	if err == nil && logContext.Endpoint == "/audio/speech" {
		body, contentType, err = service.DownloadRunningHubResult(service.RunningHubAudioURL(task.URLs))
	}
	if err != nil {
		if onFailure != nil {
			onFailure()
		}
		saveAIProxyLog(logContext, response.StatusCode, firstNonEmpty(string(task.Raw), string(payload)), err.Error())
		Fail(w, err.Error())
		return true
	}
	responseLog := "[binary audio]"
	if logContext.Endpoint != "/audio/speech" {
		data := make([]map[string]string, len(task.URLs))
		for index, url := range task.URLs {
			data[index] = map[string]string{"url": url}
		}
		body, _ = json.Marshal(map[string]any{"created": time.Now().Unix(), "data": data})
		responseLog = string(task.Raw)
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
	saveAIProxyLog(logContext, http.StatusOK, responseLog, "")
	return true
}

// transformRunningHubVideoTaskResponse maps submit and query responses onto the shared video task fields.
func transformRunningHubVideoTaskResponse(payload []byte) ([]byte, bool) {
	task, ok := service.ParseRunningHubTask(payload)
	if !ok {
		return nil, false
	}
	result := map[string]any{"task_id": task.TaskID, "status": task.Status}
	if len(task.URLs) > 0 {
		result["video_url"] = task.URLs[0]
	}
	if task.Error != "" {
		result["error"] = map[string]string{"message": task.Error}
	}
	encoded, err := json.Marshal(result)
	return encoded, err == nil
}
