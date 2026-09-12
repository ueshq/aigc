package service

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

const ModelChannelProtocolArk = "ark"

func IsArkChannel(channel model.ModelChannel) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), ModelChannelProtocolArk)
}
