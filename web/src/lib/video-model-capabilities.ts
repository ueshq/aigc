import { isGeminiConfig, isGeminiVideoModel, isGeminiVeo31Model, normalizeGeminiVideoRatio, normalizeGeminiVideoResolution } from "@/lib/gemini";
import { isMiniMaxH3Config, miniMaxVideoCapabilities, normalizeMiniMaxVideoConfig, type MiniMaxReferenceMode } from "@/lib/minimax-video";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceRatioOptions, seedanceResolutionOptions, isSeedanceFastOrMiniModel } from "@/lib/seedance-video";
import { type AiConfig } from "@/stores/use-config-store";

export function modelKey(modelName: string) {
    return modelName.trim().toLowerCase().replace(/[._/]+/g, "-");
}

export function isCogVideoX3Model(modelName: string) {
    return modelKey(modelName) === "cogvideox-3";
}

export function isAgnesVideoV25Model(modelName: string) {
    return modelKey(modelName) === "agnes-video-2-5";
}

export function supportsVideoFrameReferences(modelName: string, protocol = "") {
    const model = modelKey(modelName);
    return (
        isAgnesVideoV25Model(model) ||
        isCogVideoX3Model(model) ||
        model === "bytedance-seedance-2" ||
        model === "bytedance-seedance-2-fast" ||
        model === "bytedance-seedance-2-mini" ||
        model === "bytedance-seedance-2-5" ||
        model === "wan-2-7-image-to-video" ||
        model === "bytedance-v1-lite-image-to-video" ||
        model === "hailuo-02-image-to-video-standard" ||
        model === "hailuo-02-image-to-video-pro" ||
        model === "kling-v2-1-pro" ||
        model === "kling-v2-5-turbo-image-to-video-pro" ||
        model === "minimax-h3-image-to-video" ||
        model === "minimax-h3" ||
        model === "minimax-h3-max" ||
        model.includes("doubao-seedance-2-5") ||
        model.includes("doubao-seedance-2-0") ||
        model.includes("doubao-seedance-1-5") ||
        model.includes("doubao-seedance-1-0") ||
        model === "happyhorse-1-1" ||
        (protocol === "gemini" && isGeminiVeo31Model(modelName)) ||
        (model.includes("veo3-1") && model.includes("official")) ||
        model.includes("minimax-hailuo-02") ||
        model.includes("skyreels-v4") ||
        model.includes("pixverse-v6") ||
        model.includes("viduq3") ||
        model.includes("vidu-q3")
    );
}

export function supportsVideoAudioGeneration(modelName: string, protocol = "") {
    const model = modelKey(modelName);
    if (protocol === "minimax" && (model === "minimax-h3" || model === "minimax-h3-max")) return true;
    if (model.includes("motion-control")) return false;
    return (
        isCogVideoX3Model(model) ||
        model === "kling-2-6-text-to-video" ||
        model === "kling-2-6-image-to-video" ||
        model === "kling-text-to-video" ||
        model === "kling-image-to-video" ||
        model === "bytedance-seedance-2" ||
        model === "bytedance-seedance-2-fast" ||
        model === "bytedance-seedance-2-mini" ||
        model === "bytedance-seedance-2-5" ||
        model === "wan-2-6-flash-image-to-video" ||
        model === "wan-2-6-flash-video-to-video" ||
        model.includes("bytedance-seedance-1-5") ||
        model.includes("doubao-seedance-2-5") ||
        model.includes("doubao-seedance-2-0") ||
        model.includes("doubao-seedance-1-5") ||
        (model.includes("veo") && model.includes("official")) ||
        model === "wan2-6" ||
        model === "wan2-6-i2v-flash" ||
        model.includes("kling-v2-6") ||
        model.includes("kling-2-6") ||
        ((model.includes("kling-v3") || model.includes("kling-3-0")) && !model.includes("turbo")) ||
        model.includes("pixverse-v6") ||
        model.includes("viduq3-pro") ||
        model.includes("vidu-q3-pro") ||
        model.includes("viduq3-turbo")
    );
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}


export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.trim().toLowerCase().replace(/p$/, "") || "720";
}


export type VideoReferenceMode = MiniMaxReferenceMode;
export type VideoDurationRule = { min: number; max: number; defaultSeconds: number; values?: number[]; auto?: number };

export function videoReferenceMode(input: { firstFrame?: unknown; lastFrame?: unknown; references?: unknown[]; videoReferences?: unknown[]; audioReferences?: unknown[] }): VideoReferenceMode {
    return input.firstFrame || input.lastFrame ? "frames" : input.references?.length || input.videoReferences?.length || input.audioReferences?.length ? "reference" : "text";
}

export function videoDurationRule(config: AiConfig, mode?: VideoReferenceMode): VideoDurationRule {
    const model = config.model || config.videoModel;
    const key = modelKey(model);
    if (isMiniMaxH3Config(config, model)) return { min: miniMaxVideoCapabilities(model)!.minSeconds, max: 15, defaultSeconds: 5 };
    let values: number[] | undefined;
    if (isGeminiConfig(config, model) && isGeminiVideoModel(model)) values = normalizeGeminiVideoResolution(config.vquality) !== "720p" || mode === "frames" || mode === "reference" ? [8] : [4, 6, 8];
    else if (isCogVideoX3Model(model)) return { min: 5, max: 10, defaultSeconds: 5, values: [5, 10] };
    else if (isAgnesVideoV25Model(model)) return { min: 4, max: 12, defaultSeconds: 5 };
    else if (isSeedanceVideoConfig(config)) return { min: 4, max: key.includes("seedance-2-5") ? 30 : 15, defaultSeconds: 5, auto: -1 };
    else if (key.includes("sora-2")) values = [4, 8, 12, 16, 20];
    else if (key.includes("veo3-1") || key.includes("veo-3-1")) values = [8];
    else if (key.includes("minimax-hailuo-02")) values = [5, 10];
    else if (key.includes("minimax-hailuo-2-3")) values = [6, 10];
    else if (key.includes("omni-flash-ext")) values = [4, 6, 8, 10];
    else if (key.includes("wan2-5")) values = [5, 10];
    else if (key === "wan2-6") values = [5, 10, 15];
    return { min: values?.[0] || 1, max: values?.[values.length - 1] || 30, defaultSeconds: 6, ...(values ? { values } : {}) };
}

export function normalizeVideoDuration(value: string, rule: VideoDurationRule) {
    if (rule.auto !== undefined && Number(value) === rule.auto) return String(rule.auto);
    const seconds = Math.max(rule.min, Math.min(rule.max, Math.floor(Number(value) || rule.defaultSeconds)));
    return String(rule.values?.reduce((best, item) => Math.abs(item - seconds) < Math.abs(best - seconds) ? item : best, rule.values[0]) ?? seconds);
}

export function videoDurationHint(config: AiConfig, mode?: VideoReferenceMode) {
    const { min, max, values, auto } = videoDurationRule(config, mode);
    return { min, max, values, auto, range: values ? `仅 ${values.join("、")} 秒` : `${auto === undefined ? "" : "智能（-1）或 "}${min}–${max} 秒` };
}

export function validateVideoDuration(config: AiConfig, seconds: number, mode?: VideoReferenceMode) {
    if (!Number.isInteger(seconds)) return "视频总时长必须为整数秒";
    return normalizeVideoDuration(String(seconds), videoDurationRule(config, mode)) === String(seconds) ? "" : `当前视频模型支持${videoDurationHint(config, mode).range}`;
}

export function normalizeVideoConfig(config: AiConfig, mode?: VideoReferenceMode): AiConfig {
    const model = config.model || config.videoModel;
    const scoped = { ...config, model, videoModel: model };
    if (isMiniMaxH3Config(scoped, model)) return normalizeMiniMaxVideoConfig(scoped, mode);
    let size = normalizeVideoSizeValue(config.size);
    let vquality = normalizeVideoResolutionValue(config.vquality);
    if (isGeminiConfig(scoped, model) && isGeminiVideoModel(model)) {
        size = normalizeGeminiVideoRatio(config.size) || "adaptive";
        vquality = normalizeGeminiVideoResolution(config.vquality);
    } else if (isCogVideoX3Model(model)) {
        size = normalizeCogVideoX3Size(config.vquality, config.size);
    } else if (isAgnesVideoV25Model(model)) {
        size = normalizeSeedanceRatio(config.size);
        if (size === "adaptive") size = "16:9";
        vquality = "720P";
    } else if (isSeedanceVideoConfig(scoped)) {
        size = normalizeSeedanceRatio(config.size);
        vquality = normalizeSeedanceResolution(config.vquality, model);
    }
    return { ...scoped, size, vquality, videoSeconds: normalizeVideoDuration(config.videoSeconds, videoDurationRule(scoped, mode)), videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, false)), videoWatermark: String(boolConfig(config.videoWatermark, false)) };
}

function normalizeCogVideoX3Size(resolutionValue: string, sizeValue: string) {
    const exactSize = normalizeVideoSizeValue(sizeValue);
    if (exactSize && ["1280x720", "720x1280", "1024x1024", "1920x1080", "1080x1920", "2048x1080", "3840x2160"].includes(exactSize)) return exactSize;
    const resolution = normalizeVideoResolutionValue(resolutionValue);
    const ratio = normalizeSeedanceRatio(sizeValue);
    if (ratio === "1:1") return "1024x1024";
    if (ratio === "9:16" || ratio === "3:4") return resolution === "480" || resolution === "720" ? "720x1280" : "1080x1920";
    if (resolution === "4k") return "3840x2160";
    if (resolution === "2k") return "2048x1080";
    return resolution === "1080" ? "1920x1080" : "1280x720";
}


export function videoParameterOptions(config: AiConfig): { resolutions?: string[]; ratios?: string[] } {
    const model = config.model || config.videoModel;
    if (isMiniMaxH3Config(config, model)) return { resolutions: [...miniMaxVideoCapabilities(model)!.resolutions], ratios: seedanceRatioOptions.map((item) => item.value) };
    if (isGeminiConfig(config, model) && isGeminiVideoModel(model)) return { resolutions: ["720p", "1080p", "4k"], ratios: ["16:9", "9:16", "adaptive"] };
    if (isAgnesVideoV25Model(model)) return { resolutions: ["720P"], ratios: seedanceRatioOptions.filter((item) => item.value !== "adaptive").map((item) => item.value) };
    if (isSeedanceVideoConfig(config)) return { resolutions: seedanceResolutionOptions.filter((item) => !isSeedanceFastOrMiniModel(model) || item.value !== "1080p").map((item) => item.value), ratios: seedanceRatioOptions.map((item) => item.value) };
    return {};
}
