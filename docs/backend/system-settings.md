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
| `protocol` | string | 协议，支持 OpenAI、Gemini、MiniMax、MiMo |
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
