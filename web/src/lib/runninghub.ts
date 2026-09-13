import { audioVoiceOptions } from "@/lib/audio-generation";
import { runningHubModelCatalog } from "@/lib/runninghub-models";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export const RUNNINGHUB_CHANNEL_PROTOCOL = "runninghub" as const;
export type RunningHubVideoMode = "text" | "frames" | "reference";
export type RunningHubMediaUse = "first" | "last" | "images" | "videos" | "audios";
export type RunningHubModeCaps = {
    durations?: number[] | { min: number; max: number };
    duration?: number;
    auto?: number;
    resolutions?: string[];
    resolution?: string;
    ratios?: string[];
    ratio?: string;
    images?: number;
    videos?: number;
    audios?: number;
    lastFrame?: boolean;
    audio?: boolean;
    /** Media every endpoint of the mode requires. */
    requires?: RunningHubMediaUse[];
};
export type RunningHubModelInfo = {
    modes?: Partial<Record<RunningHubVideoMode | "edit", RunningHubModeCaps>>;
    voices?: Array<{ value: string; label: string }>;
    voice?: string;
    speed?: { min: number; max: number };
};
type RunningHubVideoInputs = { references: unknown[]; videoReferences: unknown[]; audioReferences: unknown[]; firstFrame?: unknown; lastFrame?: unknown };

const mediaLabels: Record<RunningHubMediaUse, string> = { first: "首帧", last: "尾帧", images: "参考图片", videos: "参考视频", audios: "参考音频" };

/** RunningHub endpoint families named `<family>/video`, `<family>/image`, `<family>/tts` or `<family>/music`; the backend picks the endpoint per request. */
export const runningHubModels = Object.keys(runningHubModelCatalog);

export function runningHubModelInfo(model?: string): RunningHubModelInfo | undefined {
    return runningHubModelCatalog[(model || "").trim()];
}

export function isRunningHubConfig(config: AiConfig, modelName = config.model) {
    const model = modelName.trim();
    return Boolean(runningHubModelInfo(model)) && channelProtocolForConfig({ ...config, model }) === RUNNINGHUB_CHANNEL_PROTOCOL;
}

/** Options of the endpoints serving a mode; frames use the reference endpoints when the family has no frame endpoint. */
export function runningHubVideoCapabilities(model: string, mode: RunningHubVideoMode = "text"): RunningHubModeCaps {
    const modes = runningHubModelInfo(model)?.modes || {};
    return modes[mode] || (mode === "frames" ? modes.reference : undefined) || modes.text || modes.frames || modes.reference || {};
}

/** Mirrors backend endpoint selection so unsupported inputs are reported before submitting. */
export function runningHubVideoInputError(model: string, input: RunningHubVideoInputs) {
    const modes = runningHubModelInfo(model)?.modes;
    if (!modes) return "";
    if (input.lastFrame && !input.firstFrame) return "尾帧需要搭配首帧";
    const frames = [input.firstFrame, input.lastFrame].filter(Boolean).length;
    const foldFrames = frames > 0 && !modes.frames;
    const images = input.references.length + (foldFrames ? frames : 0);
    const mode: RunningHubVideoMode = frames && !foldFrames ? "frames" : images || input.videoReferences.length || input.audioReferences.length ? "reference" : "text";
    const caps = modes[mode];
    const provided: Record<RunningHubMediaUse, number> = { first: mode === "frames" && input.firstFrame ? 1 : 0, last: mode === "frames" && input.lastFrame ? 1 : 0, images, videos: input.videoReferences.length, audios: input.audioReferences.length };
    const missing = (caps || (mode === "text" ? modes.frames || modes.reference : undefined))?.requires?.find((use) => !provided[use]);
    if (missing) return `该模型需要${mediaLabels[missing]}`;
    if (!caps) return { text: "该模型不支持纯文本生成，请添加首帧或参考素材", frames: "该模型不支持首尾帧", reference: "该模型不支持参考素材" }[mode];
    if (input.lastFrame && mode === "frames" && !caps.lastFrame) return "该模型不支持尾帧";
    const counts = [[images, caps.images, "参考图片"], [input.videoReferences.length, caps.videos, "参考视频"], [input.audioReferences.length, caps.audios, "参考音频"]] as const;
    for (const [count, limit, label] of counts) {
        if (count > (limit || 0)) return limit ? `该模型最多支持 ${limit} 个${label}` : `该模型${mode === "frames" ? "使用首尾帧时" : ""}不支持${label}`;
    }
    return "";
}

/** Keeps the voice valid for the model; OpenAI preset voices left in the shared setting fall back to the model default. */
export function normalizeRunningHubVoice(model: string, value = "") {
    const info = runningHubModelInfo(model);
    const voice = value.trim();
    if (info?.voices) return info.voices.some((item) => item.value === voice) ? voice : info.voice || info.voices[0]?.value || "";
    return voice && !audioVoiceOptions.some((item) => item.value === voice) ? voice : info?.voice || "";
}
