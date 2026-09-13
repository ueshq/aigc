package service

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
)

const (
	ModelChannelProtocolMiniMax = "minimax"
	// Internal task models share /videos; upstream always receives MiniMax-H3.
	MiniMaxContextIRModel    = "MiniMax-H3-Context-IR"
	MiniMaxRegenerationModel = "MiniMax-H3-Regenerate-2K"
)

type miniMaxVideoRequest struct {
	Model      string `json:"model"`
	Resolution string `json:"resolution"`
	Duration   int    `json:"duration"`
	Ratio      string `json:"ratio"`
	Content    []struct {
		Type string `json:"type"`
		Text string `json:"text"`
		Role string `json:"role"`
	} `json:"content"`
}

func MiniMaxModels() []string {
	return []string{"MiniMax-H3", "MiniMax-H3-Max"}
}

func IsMiniMaxChannel(channel model.ModelChannel) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), ModelChannelProtocolMiniMax)
}

func IsMiniMaxH3ModelName(modelName string) bool {
	name := strings.TrimSpace(modelName)
	return strings.EqualFold(name, "MiniMax-H3") || strings.EqualFold(name, "MiniMax-H3-Max")
}

func IsMiniMaxContextIRModelName(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), MiniMaxContextIRModel)
}

func IsMiniMaxRegenerationModelName(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), MiniMaxRegenerationModel)
}

// IsMiniMaxTaskModelName matches the official H3 models and the internal Context-IR / 2K regeneration tasks.
func IsMiniMaxTaskModelName(modelName string) bool {
	return IsMiniMaxH3ModelName(modelName) || IsMiniMaxContextIRModelName(modelName) || IsMiniMaxRegenerationModelName(modelName)
}

// MiniMaxChannelModelName resolves internal task models to the channel model that serves them.
func MiniMaxChannelModelName(modelName string) string {
	if IsMiniMaxContextIRModelName(modelName) || IsMiniMaxRegenerationModelName(modelName) {
		return "MiniMax-H3"
	}
	return modelName
}

func MiniMaxCreatePath(modelName string) string {
	switch {
	case IsMiniMaxContextIRModelName(modelName):
		return "/v2/h3_context_ir"
	case IsMiniMaxRegenerationModelName(modelName):
		return "/v2/video_regeneration"
	default:
		return "/v2/video_generation"
	}
}

// PrepareMiniMaxVideoRequest validates a MiniMax task body and sends internal task models upstream as MiniMax-H3.
func PrepareMiniMaxVideoRequest(modelName string, body []byte) ([]byte, error) {
	contextIR, regeneration := IsMiniMaxContextIRModelName(modelName), IsMiniMaxRegenerationModelName(modelName)
	if !contextIR && !regeneration {
		return body, ValidateMiniMaxVideoRequest(body)
	}
	input, err := parseMiniMaxVideoRequest(body)
	if err == nil && contextIR {
		err = validateMiniMaxContextIRRequest(input)
	} else if err == nil {
		err = validateMiniMaxRegenerationRequest(input)
	}
	var payload map[string]any
	if err == nil && json.Unmarshal(body, &payload) != nil {
		err = errors.New("MiniMax 视频请求或模型无效")
	}
	if err != nil {
		return body, err
	}
	payload["model"] = "MiniMax-H3"
	return json.Marshal(payload)
}

func ValidateMiniMaxVideoRequest(body []byte) error {
	input, err := parseMiniMaxVideoRequest(body)
	if err != nil {
		return err
	}
	if !IsMiniMaxH3ModelName(input.Model) {
		return errors.New("MiniMax 视频请求或模型无效")
	}
	maxModel := strings.EqualFold(input.Model, "MiniMax-H3-Max")
	minSeconds := 4
	resolution := input.Resolution == "768P" || input.Resolution == "2K"
	if maxModel {
		minSeconds = 5
		resolution = input.Resolution == "480P" || input.Resolution == "768P"
	}
	if !resolution || input.Duration < minSeconds || input.Duration > 15 {
		return errors.New("MiniMax 分辨率或时长不符合当前模型要求")
	}
	textOnly, err := validateMiniMaxContent(input, maxModel, false)
	if err != nil {
		return err
	}
	return validateMiniMaxRatio(input.Ratio, textOnly)
}

func validateMiniMaxContextIRRequest(input miniMaxVideoRequest) error {
	if input.Duration < 4 || input.Duration > 15 {
		return errors.New("MiniMax 提示词优化时长需要在 4–15 秒之间")
	}
	textOnly, err := validateMiniMaxContent(input, false, false)
	if err != nil {
		return err
	}
	return validateMiniMaxRatio(input.Ratio, textOnly)
}

func validateMiniMaxRegenerationRequest(input miniMaxVideoRequest) error {
	if input.Resolution != "2K" {
		return errors.New("MiniMax 重生成仅支持输出 2K")
	}
	_, err := validateMiniMaxContent(input, false, true)
	return err
}

func parseMiniMaxVideoRequest(body []byte) (miniMaxVideoRequest, error) {
	var input miniMaxVideoRequest
	if len(body) > 64*1024*1024 {
		return input, errors.New("MiniMax 请求体不能超过 64MB，请使用公网素材地址")
	}
	if json.Unmarshal(body, &input) != nil {
		return input, errors.New("MiniMax 视频请求或模型无效")
	}
	input.Model = strings.TrimSpace(input.Model)
	return input, nil
}

// validateMiniMaxContent applies the shared content rules and reports whether the request is text-only.
func validateMiniMaxContent(input miniMaxVideoRequest, maxModel bool, regeneration bool) (bool, error) {
	counts := map[string]int{}
	hasText := false
	for _, item := range input.Content {
		if item.Type == "text" {
			if utf8.RuneCountInString(item.Text) > 7000 {
				return false, errors.New("MiniMax 提示词不能超过 7000 字符")
			}
			hasText = hasText || strings.TrimSpace(item.Text) != ""
			continue
		}
		role := item.Role
		if item.Type == "image_url" && role == "" {
			role = "first_frame"
		}
		valid := item.Type == "image_url" && (role == "first_frame" || role == "last_frame" || role == "reference_image") || item.Type == "video_url" && (role == "reference_video" || regeneration && role == "base_video") || item.Type == "audio_url" && role == "reference_audio"
		if !valid {
			return false, errors.New("MiniMax 素材类型或用途无效")
		}
		counts[role]++
	}
	if !hasText {
		return false, errors.New("请输入 MiniMax 视频提示词")
	}
	if regeneration && counts["base_video"] != 1 {
		return false, errors.New("MiniMax 2K 重生成需要且只能包含 1 个基础视频")
	}
	frames := counts["first_frame"] + counts["last_frame"]
	references := counts["reference_image"] + counts["reference_video"] + counts["reference_audio"]
	if counts["last_frame"] > 0 && counts["first_frame"] == 0 {
		return false, errors.New("MiniMax 尾帧需要搭配首帧")
	}
	if frames > 0 && references > 0 {
		return false, errors.New("MiniMax 首尾帧不能与普通参考素材同时使用")
	}
	if maxModel && references > 0 {
		return false, errors.New("MiniMax-H3-Max 不支持普通参考素材，请移除后重试")
	}
	if counts["first_frame"] > 1 || counts["last_frame"] > 1 || counts["reference_image"] > 9 || counts["reference_video"] > 3 || counts["reference_audio"] > 3 {
		return false, errors.New("MiniMax 素材数量超限：首尾帧各 1 张，参考图片 9 张、视频和音频各 3 个")
	}
	return frames == 0 && references == 0, nil
}

func validateMiniMaxRatio(ratio string, textOnly bool) error {
	if textOnly && (ratio == "" || ratio == "adaptive") {
		return errors.New("MiniMax 文生视频需要指定画面比例")
	}
	switch ratio {
	case "", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
		return nil
	}
	return errors.New("MiniMax 画面比例无效")
}
