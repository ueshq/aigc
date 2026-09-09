import { channelProtocolForConfig, type AiConfig } from "@/stores/use-config-store";

export const GEMINI_PROTOCOL = "gemini" as const;
export const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export function isGeminiConfig(config: AiConfig, model = config.model) {
    return channelProtocolForConfig({ ...config, model }) === GEMINI_PROTOCOL;
}

export function isGeminiVideoModel(model: string) {
    return /^models\/veo-|^veo-/i.test(model.trim());
}

export function isGeminiTtsModel(model: string) {
    return model.trim().toLowerCase().includes("tts");
}

export function normalizeGeminiModel(model: string) {
    return model.trim().replace(/^models\//i, "");
}

export function normalizeGeminiBaseUrl(baseUrl: string) {
    return (baseUrl.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/v1beta$/i, "");
}

export function geminiActionUrl(baseUrl: string, model: string, action: "generateContent" | "streamGenerateContent" | "predictLongRunning") {
    const suffix = action === "streamGenerateContent" ? ":streamGenerateContent?alt=sse" : `:${action}`;
    return `${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(normalizeGeminiModel(model))}${suffix}`;
}

export function geminiOperationUrl(baseUrl: string, operation: string) {
    const name = operation.trim().replace(/^\/+/, "").replace(/^v1beta\//i, "");
    return `${normalizeGeminiBaseUrl(baseUrl)}/v1beta/${name}`;
}

export function dataUrlToGeminiInlineData(dataUrl: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (!match) throw new Error("Gemini 素材必须是 Base64 图片数据");
    return { inlineData: { mimeType: match[1], data: match[2] } };
}

export function geminiErrorMessage(payload: unknown, fallback: string) {
    const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
    const feedback = root.promptFeedback && typeof root.promptFeedback === "object" ? root.promptFeedback as Record<string, unknown> : {};
    const candidates = Array.isArray(root.candidates) ? root.candidates as Array<Record<string, unknown>> : [];
    return firstText(error.message, feedback.blockReason, ...candidates.map((item) => item.finishReason), fallback);
}

function firstText(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() || "";
}

export function isGeminiVeo31Model(model: string) {
    const key = normalizeGeminiModel(model).toLowerCase().replace(/_/g, "-").replace(/\./g, "-");
    return key.startsWith("veo-3-1") || key.startsWith("veo3-1");
}

export function normalizeGeminiVideoResolution(value: string) {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    if (normalized === "4k") return "4k";
    if (["1080", "2k"].includes(normalized)) return "1080p";
    return "720p";
}

export function normalizeGeminiVideoRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" || normalized === "adaptive") return "";
    if (["9:16", "3:4", "2:3", "720x1280", "1080x1920"].includes(normalized)) return "9:16";
    return "16:9";
}

export const geminiTtsVoiceOptions = [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
    "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((voice) => ({ label: voice, value: voice }));

export function normalizeGeminiTtsVoice(value: string) {
    return geminiTtsVoiceOptions.some((item) => item.value === value) ? value : "Kore";
}

export function geminiPcmBase64ToWav(data: string) {
    const binary = atob(data);
    const pcm = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) pcm[index] = binary.charCodeAt(index);
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    writeText(view, 0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    writeText(view, 8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(view, 36, "data");
    view.setUint32(40, pcm.byteLength, true);
    return new Blob([header, pcm], { type: "audio/wav" });
}

function writeText(view: DataView, offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
