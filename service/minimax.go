package service

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
)

const ModelChannelProtocolMiniMax = "minimax"

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

func ValidateMiniMaxVideoRequest(body []byte) error {
	if len(body) > 64*1024*1024 {
		return errors.New("MiniMax 请求体不能超过 64MB，请使用公网素材地址")
	}
	var input struct {
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
	if json.Unmarshal(body, &input) != nil || !IsMiniMaxH3ModelName(input.Model) {
		return errors.New("MiniMax 视频请求或模型无效")
	}
	input.Model = strings.TrimSpace(input.Model)
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
	counts := map[string]int{}
	hasText := false
	for _, item := range input.Content {
		if item.Type == "text" {
			if utf8.RuneCountInString(item.Text) > 7000 {
				return errors.New("MiniMax 提示词不能超过 7000 字符")
			}
			hasText = hasText || strings.TrimSpace(item.Text) != ""
			continue
		}
		role := item.Role
		if item.Type == "image_url" && role == "" {
			role = "first_frame"
		}
		valid := item.Type == "image_url" && (role == "first_frame" || role == "last_frame" || role == "reference_image") || item.Type == "video_url" && role == "reference_video" || item.Type == "audio_url" && role == "reference_audio"
		if !valid {
			return errors.New("MiniMax 素材类型或用途无效")
		}
		counts[role]++
	}
	if !hasText {
		return errors.New("请输入 MiniMax 视频提示词")
	}
	frames := counts["first_frame"] + counts["last_frame"]
	references := counts["reference_image"] + counts["reference_video"] + counts["reference_audio"]
	if counts["last_frame"] > 0 && counts["first_frame"] == 0 {
		return errors.New("MiniMax 尾帧需要搭配首帧")
	}
	if frames > 0 && references > 0 {
		return errors.New("MiniMax 首尾帧不能与普通参考素材同时使用")
	}
	if maxModel && references > 0 {
		return errors.New("MiniMax-H3-Max 不支持普通参考素材，请移除后重试")
	}
	if counts["first_frame"] > 1 || counts["last_frame"] > 1 || counts["reference_image"] > 9 || counts["reference_video"] > 3 || counts["reference_audio"] > 3 {
		return errors.New("MiniMax 素材数量超限：首尾帧各 1 张，参考图片 9 张、视频和音频各 3 个")
	}
	if frames == 0 && references == 0 && (input.Ratio == "" || input.Ratio == "adaptive") {
		return errors.New("MiniMax 文生视频需要指定画面比例")
	}
	if input.Ratio != "" && input.Ratio != "adaptive" && input.Ratio != "21:9" && input.Ratio != "16:9" && input.Ratio != "4:3" && input.Ratio != "1:1" && input.Ratio != "3:4" && input.Ratio != "9:16" {
		return errors.New("MiniMax 画面比例无效")
	}
	return nil
}
