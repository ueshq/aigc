---
title: 系统配置数据结构
description: settings 表中 public 和 private 配置结构说明
---

# 系统配置数据结构

系统配置保存在 `settings` 表中，目前只使用两行：

| key | 说明 |
| --- | --- |
| `public` | 公开配置，前端可以读取 |
| `private` | 私有配置，只给后端和管理员使用 |

## public.value

```json
{
  "modelChannel": {
    "availableModels": ["gpt-5.5", "gpt-image-2"],
    "modelCosts": [
      { "model": "gpt-5.5", "credits": 1 },
      { "model": "gpt-image-2", "credits": 10 }
    ],
    "defaultModel": "gpt-image-2",
    "defaultImageModel": "gpt-image-2",
    "defaultTextModel": "gpt-5.5",
    "systemPrompt": "",
    "allowCustomChannel": true
  },
  "auth": {
    "allowRegister": true,
    "linuxDo": {
      "enabled": false
    }
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `modelChannel` | object | 模型渠道公开配置组 |
| `auth` | object | 认证相关公开配置 |

`modelChannel` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `availableModels` | string[] | 系统可用模型；保存设置时会自动合并所有已启用私有渠道的模型 |
| `modelCosts` | object[] | 模型算力点配置，后端模型接口调用前按模型预扣，上游失败时返还；未配置默认不扣除 |
| `defaultModel` | string | 默认模型，从 `availableModels` 中选择；为空或失效时优先选择文本模型 |
| `defaultImageModel` | string | 默认图片模型，从 `availableModels` 中选择；为空或失效时优先选择 `seedream`、`image`、`gpt-image` 模型 |
| `defaultVideoModel` | string | 默认视频模型，从 `availableModels` 中选择；为空或失效时优先选择 `seedance`、`video` 模型 |
| `defaultTextModel` | string | 默认文本模型，从 `availableModels` 中选择；为空或失效时优先选择非图片/视频模型 |
| `systemPrompt` | string | 系统提示词 |
| `allowCustomChannel` | boolean | 是否允许用户在配置弹窗中切换为本地直连渠道，默认允许 |

`modelCosts` 每项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 模型名称 |
| `credits` | number | 每次后端模型接口调用前预扣的算力点 |

用户侧请求模式：

| 模式 | 说明 |
| --- | --- |
| 云端渠道 | 使用后端 `/api/v1/*` 代理接口，请求会按模型名匹配 `private.value.channels` 中的可用渠道 |
| 本地直连 | 默认可选；`allowCustomChannel` 关闭后不可选，用户在浏览器本地配置 `baseUrl`、`apiKey` 和模型列表后直接请求模型接口 |

`auth` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `allowRegister` | boolean | 是否允许用户注册，默认允许；关闭后注册入口隐藏，注册接口拒绝新用户创建 |
| `linuxDo.enabled` | boolean | 是否开启 Linux.do 登录 |

## private.value

```json
{
  "channels": [
    {
      "protocol": "openai",
      "name": "默认渠道",
      "baseUrl": "https://api.example.com",
      "apiKey": "sk-xxx",
      "models": ["gpt-5.5", "gpt-image-2"],
      "weight": 1,
      "enabled": true,
      "remark": ""
    }
  ],
  "promptSync": {
    "enabled": true,
    "cron": "0 0 * * *"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `channels` | object[] | 模型渠道列表 |
| `promptSync` | object | GitHub 远程提示词定时同步配置 |

`channels` 每项字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `protocol` | string | 协议，支持 OpenAI、Gemini、MiniMax、MiMo、RunningHub |
| `name` | string | 渠道名称 |
| `baseUrl` | string | 渠道接口地址 |
| `apiKey` | string | 渠道密钥 |
| `models` | string[] | 该渠道可用模型 |
| `weight` | number | 渠道权重；同一模型有多个可用渠道时按权重随机 |
| `enabled` | boolean | 是否启用 |
| `remark` | string | 备注 |

后端调用模型时，会从已启用、已配置 `baseUrl` 和 `apiKey`、且 `models` 包含目标模型的渠道中选择一个。

`promptSync` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | boolean | 是否开启定时同步，默认开启 |
| `cron` | string | Cron 表达式，默认每天 0 点 |

## MiniMax 官方视频协议

`minimax` 默认地址为国际站 `https://api.minimax.io`，国内站为 `https://api.minimax.cn`；两站接口、模型和参数一致，API Key 需与站点对应，个人配置和管理后台的接口地址下方可一键切换。使用 Bearer API Key。模型列表固定为 `MiniMax-H3`、`MiniMax-H3-Max`；读取模型列表和渠道测试均不自动生成视频。

应用继续使用现有视频任务接口，由协议层映射至 `POST /v2/video_generation` 和 `GET /v2/query/video_generation/{task_id}`，沿用任务轮询、错误展示和媒体保存。未登录使用浏览器直连；登录后的个人渠道及云端渠道使用账号代理。

- 默认 768P、5 秒。H3 支持 768P / 2K、4–15 秒；H3-Max 支持 480P / 768P、5–15 秒。
- 文生默认 16:9；首尾帧使用 adaptive，参考生成默认 adaptive。尾帧必须搭配首帧，首尾帧与普通参考素材互斥。
- H3 支持最多 9 张参考图片、3 个参考视频、3 个参考音频；参考视频和音频各总计最多 15 秒。H3-Max 不支持普通参考素材，已有素材需用户移除。
- 提示词必填且最多 7000 字符，请求体最多 64MB；校验已知素材格式、体积、尺寸和时长。成功但没有视频地址视为失败。
- 视频设置开启“添加水印”时请求携带 `aigc_watermark: true`，关闭时不发送该字段。
- 按官方建议约每 10 秒查询一次 MiniMax 任务：后端轮询器和浏览器轮询保持 5 秒节拍，距上次查询不足 7.5 秒的 MiniMax 任务跳过本轮；其他协议仍为 5 秒。

### AI 优化提示词与 2K 重生成

两项功能仅对 `MiniMax-H3` 开放，均复用 `/api/v1/videos`。账号代理时以内部模型名区分，后端按对应规则校验后把请求体 `model` 改回 `MiniMax-H3`，并按 `MiniMax-H3` 选择渠道；浏览器直连直接请求官方地址。

| 功能 | 内部模型名 | 官方接口 | 说明 |
| --- | --- | --- | --- |
| AI 优化提示词 | `MiniMax-H3-Context-IR` | `POST /v2/h3_context_ir` | 提交当前提示词、首尾帧或参考素材、时长和比例，结果为 `task.content.prompt`，确认后替换输入框。任务不写入视频任务表，通过 `GET /api/v1/videos/{task_id}` 透传官方查询。 |
| 2K 重生成 | `MiniMax-H3-Regenerate-2K` | `POST /v2/video_regeneration` | 针对成功的 768P 成片，`resolution` 固定为 `2K`，提交原提示词、原首尾帧或参考素材，以及 `role: base_video` 的成片地址；结果作为新视频任务轮询和保存。 |

- 成片地址必须能被 MiniMax 访问；本地或 `data:` 地址需先同步到云端。
- 内部模型名不出现在模型列表中；需要扣算力时，在“模型算力点”中单独设置，未设置时不扣点。
- 2K 重生成失败后重试仍基于原成片。未使用官方需白名单的 `source_task_id` 方式。

参数依据：[官方创建接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[官方查询接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)、[H3-Context-IR](https://platform.minimax.io/docs/api-reference/video-generation-v2-h3-context-ir)、[视频重生成](https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration)、[国内站创建接口](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)。真实官方请求及界面验收见待测试文档。

## RunningHub 协议

`runninghub` 默认地址为国际站 `https://www.runninghub.ai/openapi/v2`，国内站为 `https://www.runninghub.cn/openapi/v2`，只填域名时自动补全 `/openapi/v2`。使用 Bearer API Key，标准模型 API 需要企业共享 Key。仅支持登录后经后端代理调用，未登录的浏览器直连会提示先登录。

模型列表是内置的端点家族，名称以能力结尾：`/video`、`/image`、`/tts`、`/music`、`/text`、`/model3d`，例如 `kling-v3.0-pro/video`、`seedream-v4.5/image`、`minimax/speech-2.6-hd/tts`、`suno-v5/custom/music`、`rhart-text-g-25-flash/text`、`hitem3d-v15/model3d`。模型选择器显示可读名称，原始家族名作为副标题。读取模型列表和渠道测试都不发起生成。家族内的具体端点由后端按本次输入自动选择：

| 能力 | 输入 | 端点 |
| --- | --- | --- |
| 视频 | 仅提示词 | `text-to-video`；家族没有该端点时使用素材可选的参考端点 |
| 视频 | 首帧，或首帧加尾帧 | `image-to-video`、`start-end-to-video` 等；家族没有首尾帧端点时，首尾帧并入参考图 |
| 视频 | 参考图、参考视频、参考音频 | `reference-to-video`、`multimodal-video` 等 |
| 视频工具 | 参考视频，动作控制另需首帧 | 编辑、延长、动作控制、超分、补帧、去字幕、特效模板、视频翻译等，一个家族对应一个端点 |
| 口型同步 | 参考视频，加参考音频或朗读文本 | `kling-lip-sync/video`，见下文 |
| 图片 | 无参考图 / 有参考图 | `text-to-image` / `image-to-image`、`edit` |
| 图片工具 | 参考图 | Topaz、HYPIR 放大等 |
| 语音 | 文本，音色克隆另需参考音频 | TTS 端点、`minimax/voice-clone/tts`、`minimax/voice-design/tts` |
| 音乐 | 提示词，翻唱另需参考音频 | Suno、MiniMax 音乐、Mureka |
| 文本 | 提示词，可附图片或视频 | 文本生成、图片理解、视频理解、歌词、提示词增强 |
| 3D | 提示词，或一张到多张视角图 | `text-to-3d`、`image-to-3d`、`multi-image-to-3d` |

- 视频和 3D 沿用 `/api/v1/videos` 和后台任务轮询，查询改为 `POST /query`，约 5 秒一次。图片、语音、音乐和文本由后端提交任务后等待完成，再返回 `data[].url`、音频文件或 `chat.completion` JSON；等待上限为渠道超时，默认 600 秒。画布图片和音频任务同样适用。
- 参数按端点 schema 映射：时长、分辨率、比例和尺寸取最接近的可选值，必填但未设置的参数使用 RunningHub 默认值，其余可选参数不发送。视频设置按当前输入模式展示该家族可用的清晰度、比例、时长和生成音频开关。
- 高级参数：schema 中没有被自动映射的参数，如歌词、标题、风格标签、特效模板、翻译语言、面数，显示在图片、视频、音频设置和画布 3D 参数弹层的“高级参数”中。前端以 `extra_params` 发送，后端按类型转换，列表值必须命中可选项。数值按家族分别保存在个人配置，画布节点可单独覆盖。必填且没有默认值的参数未填写时，前端提交前提示，后端返回“请填写参数 X”。
- 本地文件或 Base64 素材先上传到 `POST /media/upload/binary`，公网 URL 直接透传。家族内没有端点能接受当前素材数量或组合时直接报错。
- 提示词：家族中有不需要提示词的端点时，如超分、去字幕、图生 3D，创作台和画布允许不填提示词提交。
- 语音音色：有固定列表的模型提供下拉选择，其余模型填写 RunningHub 音色 ID，留空使用模型默认音色。
- 音色克隆与设计：`minimax/voice-clone/tts` 需要连接一个参考音频节点，`minimax/voice-design/tts` 用提示词描述音色，其余参数在高级参数中填写。音色 ID 留空时自动生成，提交任务时保存到个人配置；MiniMax 语音家族的音色设置中可点选或删除这些音色。
- 音乐：`suno-v5/custom/music` 等家族在高级参数中填写歌词、标题和风格标签。歌词框旁的“AI 写歌词”用当前模型的渠道调用 `suno/lyrics/text`，把框内主题替换为生成的歌词。`minimax/music-cover/music` 需要连接一个 MP3 或 WAV 参考音频节点。
- 文本：`/text` 家族出现在文本模型列表，经 `/api/v1/chat/completions` 代理。消息中的文本合并为提示词，`image_url`、`video_url`、`audio_url` 部件作为素材，结果以非流式 JSON 一次返回。画布文本节点会把连接的视频和音频一并发送。
- 提示词优化：`minimax/hailuo-h3/video` 家族在创作台和画布显示“AI 优化”，调用 `minimax/hailuo-h3/context-ir/text`，并带上首尾帧、参考素材、时长与比例。
- 3D：画布新增 3D 模型节点。可在图片节点提示面板切换到“3D”，也可从节点菜单、配置节点或 Agent 的 `generate_model3d` 工具创建。GLB 和 glTF 结果在节点内旋转预览，OBJ、FBX 等格式只提供下载。个人配置和后台“默认 3D 模型”按 `/model3d` 后缀归类。
- 口型同步：`kling-lip-sync/video` 需要一个含清晰人脸的参考视频，分辨率需满足可灵要求（720p 或 1080p），并连接参考音频或填写朗读文本。后端先调用 `kling-lip-sync/identify-face` 识别人脸；只有文本时再用 `kling-lip-sync/tts` 合成配音，音色在高级参数中选择；最后提交 `lip-sync-video`，交给视频任务轮询。参考音频时长优先取自音频节点；可灵配音或缺少时长的音频由后端下载后按 MP3 或 WAV 测量，配音区间不超出识别到的人脸时段，无法测量时提示重新连接。
- 不接入：`marble` 世界生成、Kling 主体与角色上传、Vidu 短剧、草稿增强、Mureka 文件上传、识曲、分轨与人声克隆、预处理与重生成类端点、已废弃与异步重复版本、`doubao-seed-audio`、图层分解。
- 真实接口验收：`RUNNINGHUB_LIVE=1 go test ./service -run TestRunningHubLive -v -count=1 -timeout 40m`，读取 `.env/runninghub.env`，每种能力只提交一个最低价请求。`-run TestRunningHubLive/extended` 只跑文本、音乐参数、3D 和口型同步；音色克隆与设计不在验收中运行。普通 `go test ./...` 会跳过。
- 通用对话 LLM 也可另建 OpenAI 协议渠道，Base URL 选择预设“RunningHub LLM”，即 `https://llm.runninghub.ai/v1`。

模型目录由 `scripts/runninghub-registry.mjs` 从官方 [ComfyUI_RH_OpenAPI](https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI) 的 `models_registry.json` 生成 `service/runninghub_registry.json` 和 `web/src/lib/runninghub-models.ts`。官方新增模型后重新运行：

```bash
node scripts/runninghub-registry.mjs path/to/models_registry.json
```

平台别名：`rhart-video-s` 为 Sora 2，`rhart-video-v3.1` 为 Veo 3.1，`rhart-video-g` 为 Grok Imagine，`rhart-video-r` 为 Runway Gen-4 Turbo，`rhart-video-flux3` 为 FLUX 3 Video，`sparkvideo-2.0` 为 Seedance 2.0；`rhart-image-v1`、`rhart-image-n` 为 Nano Banana 系列，`rhart-image-g-1.5`、`rhart-image-g-2` 为 GPT Image，`rhart-image-g`、`rhart-image-g-3`、`rhart-image-g-4`、`rhart-image-x`、`rhart-imagine-image` 为 Grok 图片，`youchuan` 为 Midjourney。带 `-official` 的是官方稳定渠道，其余多为低价渠道。参数依据：[RunningHub API 文档](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287463)。
