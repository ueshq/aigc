import { audioVoiceOptions } from "@/lib/audio-generation";
import { runningHubModelCatalog } from "@/lib/runninghub-models";
import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export const RUNNINGHUB_CHANNEL_PROTOCOL = "runninghub" as const;
/** The hailuo H3 video family whose prompts the Context-IR text family can enhance. */
export const RUNNINGHUB_PROMPT_OPTIMIZE_MODEL = "minimax/hailuo-h3/video";
export const RUNNINGHUB_PROMPT_OPTIMIZER = "minimax/hailuo-h3/context-ir/text";
export const RUNNINGHUB_LYRICS_MODEL = "suno/lyrics/text";
export const RUNNINGHUB_VOICE_CLONE_MODEL = "minimax/voice-clone/tts";
export const RUNNINGHUB_VOICE_DESIGN_MODEL = "minimax/voice-design/tts";
export type RunningHubVideoMode = "text" | "frames" | "reference";
export type RunningHubMediaUse = "first" | "last" | "images" | "videos" | "audios";
export type RunningHubParamValue = string | number | boolean;
/** An endpoint schema field outside the regular settings, filled in the advanced parameter form. */
export type RunningHubParam = {
    key: string;
    type: "LIST" | "BOOLEAN" | "INT" | "FLOAT" | "STRING";
    label: string;
    description?: string;
    default?: RunningHubParamValue;
    placeholder?: string;
    options?: Array<{ value: string | number; label: string }>;
    min?: number;
    max?: number;
    step?: number;
    /** Required with no usable default, so the user must fill it in. */
    required?: boolean;
    modes?: string[];
};
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
    promptRequired?: boolean;
};
export type RunningHubModelInfo = {
    label?: string;
    description?: string;
    params?: RunningHubParam[];
    modes?: Partial<Record<RunningHubVideoMode | "edit", RunningHubModeCaps>>;
    voices?: Array<{ value: string; label: string }>;
    voice?: string;
    speed?: { min: number; max: number };
};
export type RunningHubVoice = { id: string; name: string; model: string; createdAt: string };
type RunningHubVideoInputs = { references: unknown[]; videoReferences: unknown[]; audioReferences: unknown[]; firstFrame?: unknown; lastFrame?: unknown };
type RunningHubParamStore = Record<string, Record<string, RunningHubParamValue>>;

const mediaLabels: Record<RunningHubMediaUse, string> = { first: "首帧", last: "尾帧", images: "参考图片", videos: "参考视频", audios: "参考音频" };

/** RunningHub endpoint families named `<family>/<kind>` (video, image, tts, music, text, model3d); the backend picks the endpoint per request. */
export const runningHubModels = Object.keys(runningHubModelCatalog);

export function runningHubModelInfo(model?: string): RunningHubModelInfo | undefined {
    return runningHubModelCatalog[(model || "").trim()];
}

export function isRunningHubConfig(config: AiConfig, modelName = config.model) {
    const model = modelName.trim();
    return Boolean(runningHubModelInfo(model)) && channelProtocolForConfig({ ...config, model }) === RUNNINGHUB_CHANNEL_PROTOCOL;
}

/** True when some endpoint of the family works without a prompt, such as upscalers or image-to-3D. */
export function runningHubPromptOptional(config: AiConfig, model = config.model) {
    const modes = isRunningHubConfig(config, model) ? runningHubModelInfo(model)?.modes : undefined;
    return Boolean(modes && Object.values(modes).some((caps) => !caps?.promptRequired));
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

function parseParamStore(store?: string): RunningHubParamStore {
    try {
        const parsed = JSON.parse(store || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** Advanced parameter values of one family; the store keeps a JSON bucket per family so switching models keeps them apart. */
export function runningHubParamValues(store: string | undefined, model: string): Record<string, RunningHubParamValue> {
    return parseParamStore(store)[model.trim()] || {};
}

export function setRunningHubParamValues(store: string | undefined, model: string, values: Record<string, RunningHubParamValue | undefined>) {
    const cleaned = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
    return JSON.stringify({ ...parseParamStore(store), [model.trim()]: cleaned });
}

/** Node-level values override global ones family by family. */
export function mergeRunningHubParams(base?: string, override?: string) {
    const merged = parseParamStore(base);
    for (const [model, values] of Object.entries(parseParamStore(override))) merged[model] = { ...merged[model], ...values };
    return JSON.stringify(merged);
}

export function runningHubParamsError(model: string, values: Record<string, RunningHubParamValue>, mode?: string) {
    const missing = runningHubModelInfo(model)?.params?.find((param) => param.required && (!mode || !param.modes || param.modes.includes(mode)) && String(values[param.key] ?? "").trim() === "");
    return missing ? `请在高级参数中填写「${missing.label}」` : "";
}

export function parseRunningHubVoices(store?: string): RunningHubVoice[] {
    try {
        const parsed = JSON.parse(store || "[]");
        return Array.isArray(parsed) ? parsed.filter((item): item is RunningHubVoice => typeof item?.id === "string") : [];
    } catch {
        return [];
    }
}

/** A custom voice ID RunningHub accepts: starts with a letter, letters and digits only, at least 8 characters. */
export function createRunningHubVoiceId(now = new Date()) {
    return `RH${now.toISOString().replace(/\D/g, "").slice(0, 14)}${Math.random().toString(36).slice(2, 6)}`;
}
