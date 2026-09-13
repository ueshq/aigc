#!/usr/bin/env node
/**
 * Generates the RunningHub model registries from the official ComfyUI_RH_OpenAPI registry:
 *   node scripts/runninghub-registry.mjs path/to/models_registry.json
 * Source: https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/models_registry.json
 *
 * Endpoints are grouped into families named `<family>/<kind>` with kind video, image, tts, music, text or model3d.
 * The backend picks the family endpoint that fits the request inputs and maps unmapped schema fields from advanced
 * parameters; the frontend reads per-mode options, labels and those advanced parameter definitions.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) throw new Error("usage: node scripts/runninghub-registry.mjs <models_registry.json>");
const root = fileURLToPath(new URL("..", import.meta.url));
const models = JSON.parse(readFileSync(source, "utf8"));
const byEndpoint = Object.fromEntries(models.map((model) => [model.endpoint, model]));

// Account utilities, external viewers and workflows whose inputs the product cannot provide.
const excluded = /marble|kling-elements|upload-character|short-play|draft-enhance|files-upload|recognize-song|describe-song|stem-song|vocal-clone|preprocess|regeneration|deprecated|asyn|doubao-seed-audio|layer-decomposition|kling-lip-sync/i;
const kindOverrides = { "pixverse-v6/extend": "video" };
const aliases = {
    "vidu/text-to-video": "vidu/q2",
    "minimax/hailuo-h3/context-ir-text": "minimax/hailuo-h3/context-ir",
    "minimax/hailuo-h3/context-ir-image": "minimax/hailuo-h3/context-ir",
    "minimax/hailuo-h3/context-ir-multimodal": "minimax/hailuo-h3/context-ir",
};
const modeTokens = {
    video: [
        ["text", /(^|-)(text-to-video|t2v)(?=-|$)/],
        ["frames", /(^|-)(image-to-video|i2v|start-end-to-video|start-to-end|transition)(?=-|$)/],
        ["reference", /(^|-)(reference-to-video|refrence-to-video|multimodal-video|multimodal-to-video|omni-reference)(?=-|$)/],
    ],
    image: [
        ["text", /(^|-)text-to-image(?=-|$)/],
        ["edit", /(^|-)(image-to-image|image-edit|edit)(?=-|$)/],
    ],
    text: [
        ["text", /(^|-)(text-to-text|chat|context-ir-text)(?=-|$)/],
        ["frames", /(^|-)context-ir-image(?=-|$)/],
        ["reference", /(^|-)(image-to-text|video-to-text|context-ir-multimodal)(?=-|$)/],
    ],
    model3d: [
        ["text", /(^|-)text-to-3d(?=-|$)/],
        ["reference", /(^|-)(multi-image-to-3d|image-to-3d)(?=-|$)/],
    ],
};
const mediaUses = ["first", "last", "images", "videos", "audios"];
const mediaTypes = ["IMAGE", "VIDEO", "AUDIO"];
const hiddenParams = new Set(["enable_base64_output", "stream", "clientToken"]);
const viewImageKeys = ["frontImageUrl", "backImageUrl", "leftImageUrl", "rightImageUrl", "topImageUrl", "bottomImageUrl", "leftFrontImageUrl", "rightFrontImageUrl"];
const paramLabels = { negativePrompt: "负向提示词", seed: "随机种子", cfgScale: "提示词相关性", guidanceScale: "提示词相关性", movementAmplitude: "运动幅度", cameraFixed: "固定镜头", bgm: "背景音乐", enablePromptExpansion: "提示词扩写", promptExtend: "提示词扩写", promptOptimizer: "提示词优化", style: "风格", title: "标题", tags: "风格标签", lyrics: "歌词", make_instrumental: "纯音乐", isInstrumental: "纯音乐", n: "生成数量", mode: "模式", shotType: "分镜方式", multiShot: "多镜头", aigc_watermark: "AIGC 水印", aigcWatermark: "AIGC 水印", keepOriginalSound: "保留原声", characterOrientation: "人物朝向", scale: "放大倍数", upscale: "放大倍数", format: "格式", outputFormat: "输出格式", sampleRate: "采样率", bitrate: "码率", emotion: "情绪", pitch: "音调", volume: "音量", voiceId: "音色", voiceLanguage: "音色语种", voiceSpeed: "语速", soundVolume: "配音音量", originalAudioVolume: "原声音量", custom_voice_id: "自定义音色 ID", voiceId_design: "音色 ID", previewText: "试听文本" };
const standardRatios = ["21:9", "2:1", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "1:2", "9:21"];
const standardLevels = [360, 480, 540, 720, 768, 1080, 1440, 2160];

function modelKind(model) {
    const endpoint = model.endpoint;
    if (excluded.test(endpoint)) return "";
    if (kindOverrides[endpoint]) return kindOverrides[endpoint];
    if (/^rhart-audio\/text-to-audio\/(speech-|voice-clone)|^minimax\/voice-design|^alibaba\/qwen3-tts|^bytedance\/doubao-seed-tts/.test(endpoint)) return "tts";
    if (/lyrics|context-ir/.test(endpoint)) return "text";
    if (/^mureka/.test(endpoint)) return "music";
    return { image: "image", video: "video", audio: "music", "3d": "model3d", string: "text" }[model.output_type] || "";
}

function familyName(endpoint, kind) {
    if (aliases[endpoint]) return `${aliases[endpoint]}/${kind}`;
    const base = endpoint.replace("rhart-audio/text-to-audio/", "minimax/").replace(/^rhart-audio\//, "");
    if (kind === "tts") return `${base.replace(/^(alibaba|bytedance)\//, "")}/tts`;
    if (kind === "music") return `${base.replace(/^mureka-ai\//, "")}/music`;
    const segments = base.split("/");
    let last = segments.pop();
    for (const [, pattern] of modeTokens[kind]) last = last.replace(pattern, "");
    last = last.replace(/--+/g, "-").replace(/^-|-$/g, "");
    return [...segments, ...(last && last !== kind ? [last] : []), kind].join("/");
}

function tokenMode(endpoint, kind) {
    const last = endpoint.split("/").pop();
    return (modeTokens[kind] || []).find(([, pattern]) => pattern.test(last))?.[0] || "";
}

const parseDims = (value) => {
    const match = /^(\d+)\s*[x*]\s*(\d+)$/i.exec(String(value ?? "").trim());
    return match ? [Number(match[1]), Number(match[2])] : null;
};

function paramUse(kind, param) {
    const key = param.fieldKey;
    const dims = (param.options || []).some((option) => parseDims(option.value));
    if (param.type === "IMAGE") {
        if (["firstImageUrl", "firstFrameUrl"].includes(key)) return "first";
        if (["lastImageUrl", "lastFrameUrl", "endImageUrl"].includes(key)) return "last";
        if (["imageUrls", "referenceImages", "keyframes", "referenceImageUrl", ...viewImageKeys].includes(key)) return "images";
        if (["imageUrl", "image"].includes(key)) return kind === "video" ? "first" : "images";
        return "";
    }
    if (param.type === "VIDEO") return ["videoUrls", "videoUrl", "videos", "video", "startVideo"].includes(key) ? "videos" : "";
    if (param.type === "AUDIO") return ["audioUrls", "audioUrl", "audio", "fileUrl"].includes(key) ? "audios" : "";
    if (param.type === "STRING" && (["prompt", "text", "description"].includes(key) || (kind === "text" && key === "lyrics"))) return "prompt";
    if (kind === "music" || kind === "text" || kind === "model3d") return "";
    if (kind === "tts") return ["voice_id", "voice", "speaker"].includes(key) ? "voice" : key === "speed" && param.type === "FLOAT" ? "speed" : "";
    if (key === "duration" && kind === "video") return "duration";
    if (["size", "resolution", "aspectRatio", "ratio"].includes(key) && dims) return "size";
    if (key === "resolution") return kind === "video" ? "resolution" : "level";
    if (key === "targetResolution" && kind === "video") return "resolution";
    if (["aspectRatio", "ratio"].includes(key)) return "ratio";
    if (kind === "image" && ["width", "height"].includes(key) && param.type === "INT") return key;
    if (kind === "image" && key === "quality") return "quality";
    if (kind === "image" && ["n", "imageNum", "numImages"].includes(key)) return "count";
    if (kind === "video" && ["generateAudio", "sound", "audio", "generateAudioSwitch", "enableAudio"].includes(key) && (param.type === "BOOLEAN" || (param.options || []).some((option) => option.value === "true"))) return "audio";
    return "";
}

const clean = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length)));

function registryParam(kind, param) {
    const use = paramUse(kind, param);
    const media = mediaUses.includes(use);
    const defaultValue = media || use === "prompt" || (!use && param.type === "STRING") ? undefined : param.defaultValue;
    return clean({ key: param.fieldKey, type: param.type, use, required: param.required || undefined, default: defaultValue, options: param.options?.map((option) => option.value), min: param.min, max: param.max, step: param.step, limit: media ? param.maxInputNum || 1 : undefined, multiple: media && (param.multipleInputs || (param.maxInputNum || 1) > 1) ? true : undefined });
}

function paramLabel(param) {
    if (paramLabels[param.fieldKey]) return paramLabels[param.fieldKey];
    const head = String(param.description || "").trim().split(/[，。,；;（(：:\n]/)[0].trim();
    return head && head !== param.fieldKey && head.length <= 24 ? head : param.fieldKey;
}

// Advanced parameters: unmapped, non-media schema fields the user fills in the settings panel.
function isAdvancedParam(source, param) {
    return !param.use && !mediaTypes.includes(source.type) && !hiddenParams.has(source.fieldKey);
}

function uiParam(source, required) {
    const description = String(source.description || "").trim();
    const options = source.options?.map((option) => ({ value: option.value, label: String(option.description && option.description !== String(option.value) ? option.description : option.value).slice(0, 40) }));
    return clean({ key: source.fieldKey, type: source.type === "SIZE" ? "LIST" : source.type, label: paramLabel(source), description: description && description !== source.fieldKey && description !== paramLabel(source) ? description.slice(0, 200) : undefined, default: source.type === "STRING" ? undefined : source.defaultValue, placeholder: source.type === "STRING" && source.defaultValue ? String(source.defaultValue).slice(0, 80) : undefined, options, min: source.min, max: source.max, step: source.step, required: required || undefined });
}

function endpointModes(kind, params) {
    const has = (use) => params.some((param) => param.use === use);
    const requiredMedia = params.some((param) => param.required && mediaUses.includes(param.use));
    if (kind === "tts" && !has("audios")) return ["text"];
    if (kind === "image") return [...(requiredMedia ? [] : ["text"]), ...(has("images") ? ["edit"] : [])];
    return [...(requiredMedia ? [] : ["text"]), ...(has("first") ? ["frames"] : []), ...(has("images") || has("videos") || has("audios") ? ["reference"] : [])];
}

const unique = (values) => [...new Set(values.filter(Boolean))];
const nearest = (values, target, distance) => values.reduce((best, value) => (distance(value, target) < distance(best, target) ? value : best));
const logDistance = (a, b) => Math.abs(Math.log(a / b));
const ratioValue = (ratio) => Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]);

function levelLabel(value) {
    const text = String(value ?? "").trim().toLowerCase();
    const dims = parseDims(text);
    if (dims) {
        const level = nearest(standardLevels, Math.sqrt((dims[0] * dims[1] * 9) / 16), logDistance);
        return level === 1440 ? "2k" : level === 2160 ? "4k" : `${level}p`;
    }
    if (text === "hd") return "720p";
    if (text === "fhd") return "1080p";
    if (/^\d+p?$/.test(text)) return `${text.replace(/p$/, "")}p`;
    return /^(native)?\d+(p|k)$/.test(text) ? text : "";
}

function ratioLabel(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text === "adaptive" || text === "auto") return "adaptive";
    if (/^\d+:\d+$/.test(text)) return text;
    const dims = parseDims(text);
    return dims ? nearest(standardRatios, dims[0] / dims[1], (ratio, target) => logDistance(ratioValue(ratio), target)) : "";
}

function videoOptions(endpointParams) {
    const find = (use) => endpointParams.flat().find((param) => param.use === use);
    const caps = {};
    const duration = find("duration");
    if (duration?.type === "INT") caps.durations = { min: duration.min ?? 1, max: duration.max ?? 30 };
    else if (duration) {
        const values = unique((duration.options || []).map(Number).filter((value) => value > 0));
        if (values.length) caps.durations = values.sort((a, b) => a - b);
        if ((duration.options || []).map(String).includes("-1")) caps.auto = -1;
    }
    if (Number(duration?.default) > 0) caps.duration = Number(duration.default);
    const levelSource = find("resolution") || find("size");
    const resolutions = unique((levelSource?.options || []).map(levelLabel));
    if (resolutions.length) Object.assign(caps, { resolutions, resolution: levelLabel(levelSource.default) || resolutions[0] });
    const ratioSource = find("ratio") || find("size");
    const ratios = unique((ratioSource?.options || []).map(ratioLabel));
    if (ratios.length) Object.assign(caps, { ratios, ratio: ratioLabel(ratioSource.default) || ratios[0] });
    if (endpointParams.some((params) => params.some((param) => param.use === "audio"))) caps.audio = true;
    return caps;
}

function modeCaps(kind, endpointParams) {
    const caps = kind === "video" ? videoOptions(endpointParams) : {};
    for (const use of ["images", "videos", "audios"]) {
        const limit = Math.max(0, ...endpointParams.map((params) => params.filter((param) => param.use === use).reduce((sum, param) => sum + param.limit, 0)));
        if (limit) caps[use] = limit;
    }
    if (endpointParams.some((params) => params.some((param) => param.use === "last"))) caps.lastFrame = true;
    const requires = mediaUses.filter((use) => endpointParams.every((params) => params.some((param) => param.use === use && param.required)));
    if (requires.length) caps.requires = requires;
    if (endpointParams.every((params) => params.some((param) => param.use === "prompt" && param.required))) caps.promptRequired = true;
    return caps;
}

function familyParams(modes) {
    const entries = new Map();
    for (const [mode, list] of Object.entries(modes)) {
        for (const endpoint of list) {
            byEndpoint[endpoint].params.forEach((source, index) => {
                if (!isAdvancedParam(source, endpoints[endpoint][index])) return;
                const entry = entries.get(source.fieldKey) || { source, modes: new Set(), required: true };
                entry.modes.add(mode);
                entry.required &&= Boolean(source.required) && (source.type === "STRING" || source.defaultValue === undefined);
                entries.set(source.fieldKey, entry);
            });
        }
    }
    return [...entries.values()].map(({ source: param, modes: paramModes, required }) => ({ ...uiParam(param, required), modes: [...paramModes] }));
}

const modePhrase = /\b(?:text|image|video|reference|refrence|start-end|multi-image|image-audio)[ -]to[ -](?:video|image|text|3d)\b|\bmultimodal(?:-to)?-video\b|\bimage-edit\b|\bstart-to-end\b|\(first\/last frame\)|\b(?:i2v|t2v)\b/gi;
function familyLabel(kind, nameEn) {
    const label = nameEn.replace(/-?official-stable/i, " 官方稳定").replace(/-?channel-low-price/i, " 低价").replace(modePhrase, " ");
    return (kind === "image" ? label.replace(/\bedit\b/gi, " ") : label).replace(/[/_]+/g, " ").replace(/(^|\s)-+|-+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

const families = {};
const endpoints = {};
for (const model of [...models].sort((a, b) => a.endpoint.localeCompare(b.endpoint))) {
    const kind = modelKind(model);
    if (!kind) continue;
    const params = model.params.map((param) => registryParam(kind, param));
    const expressible = params.some((param) => param.use === "prompt" || mediaUses.includes(param.use));
    const blocked = model.params.some((param, index) => param.required && !params[index].use && mediaTypes.includes(param.type));
    if (!expressible || blocked) continue;
    endpoints[model.endpoint] = params;
    const family = (families[familyName(model.endpoint, kind)] ||= {});
    for (const mode of endpointModes(kind, params)) (family[mode] ||= []).push(model.endpoint);
}

const catalog = {};
for (const [name, modes] of Object.entries(families)) {
    const kind = name.split("/").pop();
    for (const [mode, list] of Object.entries(modes)) list.sort((a, b) => Number(tokenMode(b, kind) === mode) - Number(tokenMode(a, kind) === mode));
    const first = byEndpoint[["text", "frames", "reference", "edit"].map((mode) => modes[mode]?.[0]).find(Boolean)];
    const label = familyLabel(kind, first.name_en || first.endpoint);
    const entry = { label, ...(first.name_cn && first.name_cn !== first.name_en && first.name_cn !== label ? { description: first.name_cn } : {}) };
    if (kind === "tts") {
        const params = endpoints[first.endpoint];
        const voice = params.find((param) => param.use === "voice");
        const speed = params.find((param) => param.use === "speed");
        const voiceSource = first.params.find((param) => param.fieldKey === voice?.key);
        Object.assign(entry, voice?.type === "LIST" ? { voices: voiceSource.options.map((option) => ({ value: option.value, label: String(option.description || option.value).split("·")[0] })) } : {}, voice?.default ? { voice: voice.default } : {}, speed ? { speed: { min: speed.min ?? 0.5, max: speed.max ?? 2 } } : {});
    }
    const params = familyParams(modes);
    catalog[name] = { ...entry, ...(params.length ? { params } : {}), modes: Object.fromEntries(Object.entries(modes).map(([mode, list]) => [mode, modeCaps(kind, list.map((endpoint) => endpoints[endpoint]))])) };
}

// Kling lip sync chains face identification, optional Kling TTS and lip-sync-video in the backend.
const lipSyncSteps = ["kling-lip-sync/identify-face", "kling-lip-sync/tts", "kling-lip-sync/lip-sync-video"];
for (const endpoint of lipSyncSteps) endpoints[endpoint] = byEndpoint[endpoint].params.map((param) => registryParam("video", param));
families["kling-lip-sync/video"] = { reference: ["kling-lip-sync/lip-sync-video"] };
const lipSyncParams = [["kling-lip-sync/tts", ["voiceId", "voiceLanguage", "voiceSpeed"]], ["kling-lip-sync/lip-sync-video", ["soundVolume", "originalAudioVolume"]]].flatMap(([endpoint, keys]) => byEndpoint[endpoint].params.filter((param) => keys.includes(param.fieldKey)).map((param) => ({ ...uiParam(param, false), modes: ["reference"] })));
catalog["kling-lip-sync/video"] = { label: "可灵对口型", description: "识别参考视频中的人脸，用参考音频或朗读文本驱动口型", params: lipSyncParams, modes: { reference: { videos: 1, audios: 1, requires: ["videos"] } } };

const lines = (object) => `{\n${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(object[key])}`).join(",\n")}\n}`;
writeFileSync(`${root}service/runninghub_registry.json`, `{"families":${lines(families)},\n"endpoints":${lines(endpoints)}}\n`);
writeFileSync(
    `${root}web/src/lib/runninghub-models.ts`,
    `// Generated by scripts/runninghub-registry.mjs from the RunningHub model registry; do not edit.\nimport type { RunningHubModelInfo } from "./runninghub";\n\nexport const runningHubModelCatalog: Record<string, RunningHubModelInfo> = ${lines(catalog)};\n`,
);
console.log(`families=${Object.keys(families).length} endpoints=${Object.keys(endpoints).length}`);
