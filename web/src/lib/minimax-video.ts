import type { ReferenceImage, ReferenceAudio, ReferenceVideo } from "@/types/media";
import { normalizeSeedanceRatio, seedanceRatioOptions } from "@/lib/seedance-video";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export const MINIMAX_CHANNEL_PROTOCOL = "minimax" as const;
export const miniMaxVideoModels = {
    "MiniMax-H3": { resolutions: ["768P", "2K"], minSeconds: 4, references: true },
    "MiniMax-H3-Max": { resolutions: ["480P", "768P"], minSeconds: 5, references: false },
} as const;
export const miniMaxModels = Object.keys(miniMaxVideoModels);
export const miniMaxRatioOptions = seedanceRatioOptions;
export const MINIMAX_REQUEST_MAX_BYTES = 64 * 1024 * 1024;
export const miniMaxMediaLimits = { image: 30 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 15 * 1024 * 1024 };
export const miniMaxMediaFormats = {
    image: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"],
    video: ["video/mp4", "video/quicktime"],
    audio: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"],
};

export function miniMaxVideoCapabilities(model: string) {
    const key = miniMaxModels.find((name) => name.toLowerCase() === model.trim().toLowerCase());
    return key ? miniMaxVideoModels[key as keyof typeof miniMaxVideoModels] : null;
}

export function isMiniMaxChannel(channel?: { protocol?: string }) {
    return channel?.protocol === MINIMAX_CHANNEL_PROTOCOL;
}

export function isMiniMaxH3Config(config: AiConfig, modelName: string) {
    const model = modelName.trim();
    return Boolean(miniMaxVideoCapabilities(model)) && channelProtocolForConfig({ ...config, model, videoModel: model }) === MINIMAX_CHANNEL_PROTOCOL;
}

export function normalizeMiniMaxH3Resolution(value: string, model = "MiniMax-H3") {
    const resolution = value.trim().toUpperCase().replace(/P$/, "");
    const normalized = resolution === "2K" ? "2K" : `${resolution}P`;
    const options: readonly string[] = miniMaxVideoCapabilities(model)?.resolutions || ["768P", "2K"];
    return options.includes(normalized) ? normalized : "768P";
}

export function normalizeMiniMaxH3Duration(value: string, model = "MiniMax-H3") {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(miniMaxVideoCapabilities(model)?.minSeconds || 4, Math.min(15, seconds));
}

export type MiniMaxReferenceMode = "text" | "frames" | "reference";

export function normalizeMiniMaxH3Ratio(value: string, mode?: MiniMaxReferenceMode) {
    const ratio = normalizeSeedanceRatio(value);
    return mode === "frames" ? "adaptive" : mode === "text" && ratio === "adaptive" ? "16:9" : ratio;
}

export function normalizeMiniMaxVideoConfig(config: AiConfig, mode?: MiniMaxReferenceMode): AiConfig {
    const model = config.model || config.videoModel;
    if (!isMiniMaxH3Config(config, model)) return config;
    return { ...config, vquality: normalizeMiniMaxH3Resolution(config.vquality, model), videoSeconds: String(normalizeMiniMaxH3Duration(config.videoSeconds, model)), size: normalizeMiniMaxH3Ratio(config.size, mode), videoGenerateAudio: "true" };
}

export type MiniMaxVideoReferences = {
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    firstFrame: ReferenceImage | null;
    lastFrame: ReferenceImage | null;
};

export function miniMaxVideoInputError(model: string, prompt: string, input: MiniMaxVideoReferences) {
    if (!prompt.trim()) return "请输入 MiniMax 视频提示词";
    if (Array.from(prompt).length > 7000) return "MiniMax 提示词不能超过 7000 字符";
    const capability = miniMaxVideoCapabilities(model);
    if (!capability) return "不支持的 MiniMax 视频模型";
    const frames = Boolean(input.firstFrame || input.lastFrame);
    const references = input.references.length + input.videoReferences.length + input.audioReferences.length;
    if (input.lastFrame && !input.firstFrame) return "MiniMax 尾帧需要搭配首帧";
    if (frames && references) return "MiniMax 首尾帧不能与普通参考素材同时使用";
    if (!capability.references && references) return "MiniMax-H3-Max 不支持普通参考素材，请移除后重试";
    if (input.references.length > 9 || input.videoReferences.length > 3 || input.audioReferences.length > 3) return "MiniMax 参考图片最多 9 张，参考视频和音频各最多 3 个";
    const groups = [
        { kind: "image", label: "图片", items: [...input.references, ...[input.firstFrame, input.lastFrame].filter((image): image is ReferenceImage => Boolean(image))] },
        { kind: "video", label: "视频", items: input.videoReferences },
        { kind: "audio", label: "音频", items: input.audioReferences },
    ] as const;
    for (const group of groups) {
        let totalDuration = 0;
        for (const item of group.items) {
            if (item.type && !item.type.endsWith("/*") && item.type !== "application/octet-stream" && !miniMaxMediaFormats[group.kind].includes(item.type.toLowerCase())) return `MiniMax 参考${group.label}格式不支持`;
            if ("bytes" in item && item.bytes && item.bytes > miniMaxMediaLimits[group.kind]) return `MiniMax 参考${group.label}超过 ${miniMaxMediaLimits[group.kind] / 1024 / 1024}MB`;
            if ("durationMs" in item && typeof item.durationMs === "number") {
                if (item.durationMs < 2000 || item.durationMs > 15000) return `MiniMax 参考${group.label}时长需要在 2–15 秒之间`;
                totalDuration += item.durationMs;
            }
            if ("width" in item && item.width && item.height) {
                if (item.width < 256 || item.width > 5760 || item.height < 256 || item.height > 5760 || item.width / item.height < 0.4 || item.width / item.height > 2.5) return `MiniMax 参考${group.label}尺寸需要为 256–5760px，宽高比为 0.4–2.5`;
            }
        }
        if (totalDuration > 15000) return `MiniMax 参考${group.label}总时长不能超过 15 秒`;
    }
    return "";
}
