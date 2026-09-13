#!/usr/bin/env node
/**
 * Generates the RunningHub model registries from the official ComfyUI_RH_OpenAPI registry:
 *   node scripts/runninghub-registry.mjs path/to/models_registry.json
 * Source: https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/models_registry.json
 *
 * Endpoints are grouped into families named `<family>/video`, `<family>/image` or `<family>/tts`.
 * The backend picks the family endpoint that fits the request inputs; the frontend reads per-mode options.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) throw new Error("usage: node scripts/runninghub-registry.mjs <models_registry.json>");
const root = fileURLToPath(new URL("..", import.meta.url));
const models = JSON.parse(readFileSync(source, "utf8"));

const excluded = /edit-video|video-edit|extend|extension|motion|lip|effect|upscal|translat|erase|world|character|element|fps|restyl|draft|dreamactor|avatar|lora|video-to-video|continuation|regeneration|deprecated|asyn|upload|enhance|topaz|hypir|marble|context-ir|-star/i;
const aliases = { "vidu/text-to-video": "vidu/q2" };
const modeTokens = [
    ["text", /(^|-)(text-to-video|t2v|text-to-image)(?=-|$)/],
    ["frames", /(^|-)(image-to-video|i2v|start-end-to-video|start-to-end|transition)(?=-|$)/],
    ["reference", /(^|-)(reference-to-video|refrence-to-video|multimodal-video|multimodal-to-video|omni-reference)(?=-|$)/],
    ["edit", /(^|-)(image-to-image|image-edit|edit)(?=-|$)/],
];
const mediaUses = ["first", "last", "images", "videos", "audios"];
const standardRatios = ["21:9", "2:1", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "1:2", "9:21"];
const standardLevels = [360, 480, 540, 720, 768, 1080, 1440, 2160];

function modelKind(model) {
    const keys = new Set(model.params.map((param) => param.fieldKey));
    const endpoint = model.endpoint;
    if (/^rhart-audio\/text-to-audio\/speech-|^alibaba\/qwen3-tts|^bytedance\/doubao-seed-tts/.test(endpoint)) return "tts";
    if (!["image", "video"].includes(model.output_type) || excluded.test(endpoint) || !keys.has("prompt")) return "";
    return model.output_type;
}

function familyName(endpoint, kind) {
    if (kind === "tts") return `${endpoint.replace("rhart-audio/text-to-audio/", "minimax/").replace(/^(alibaba|bytedance)\//, "")}/tts`;
    if (aliases[endpoint]) return `${aliases[endpoint]}/${kind}`;
    const segments = endpoint.split("/");
    let last = segments.pop();
    for (const [, pattern] of modeTokens) last = last.replace(pattern, "");
    last = last.replace(/--+/g, "-").replace(/^-|-$/g, "");
    return [...segments, ...(last ? [last] : []), kind].join("/");
}

function tokenMode(endpoint) {
    const last = endpoint.split("/").pop();
    return modeTokens.find(([, pattern]) => pattern.test(last))?.[0] || "";
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
        if (["imageUrls", "referenceImages", "keyframes"].includes(key)) return "images";
        if (["imageUrl", "image"].includes(key)) return kind === "video" ? "first" : "images";
        return "";
    }
    if (param.type === "VIDEO") return ["videoUrls", "videoUrl", "videos"].includes(key) ? "videos" : "";
    if (param.type === "AUDIO") return ["audioUrls", "audioUrl"].includes(key) ? "audios" : "";
    if (["prompt", "text"].includes(key) && param.type === "STRING") return "prompt";
    if (kind === "tts") return ["voice_id", "voice", "speaker"].includes(key) ? "voice" : key === "speed" && param.type === "FLOAT" ? "speed" : "";
    if (key === "duration" && kind === "video") return "duration";
    if (["size", "resolution", "aspectRatio", "ratio"].includes(key) && dims) return "size";
    if (key === "resolution") return kind === "video" ? "resolution" : "level";
    if (["aspectRatio", "ratio"].includes(key)) return "ratio";
    if (kind === "image" && ["width", "height"].includes(key) && param.type === "INT") return key;
    if (kind === "image" && key === "quality") return "quality";
    if (kind === "image" && ["n", "imageNum", "numImages"].includes(key)) return "count";
    if (kind === "video" && ["generateAudio", "sound", "audio", "generateAudioSwitch", "enableAudio"].includes(key) && (param.type === "BOOLEAN" || (param.options || []).some((option) => option.value === "true"))) return "audio";
    return "";
}

function registryParam(kind, param) {
    const use = paramUse(kind, param);
    const media = mediaUses.includes(use);
    const entry = { key: param.fieldKey, type: param.type, use, required: param.required || undefined, default: media || use === "prompt" ? undefined : param.defaultValue, options: param.options?.map((option) => option.value), min: param.min, max: param.max, step: param.step, limit: media ? param.maxInputNum || 1 : undefined, multiple: media && (param.multipleInputs || (param.maxInputNum || 1) > 1) ? true : undefined };
    return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)));
}

function endpointModes(kind, params) {
    const has = (use) => params.some((param) => param.use === use);
    const requiredMedia = params.some((param) => param.required && mediaUses.includes(param.use));
    if (kind === "tts") return ["text"];
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

function videoModeCaps(endpointParams) {
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
    const resolution = find("resolution");
    const ratio = find("ratio");
    const size = find("size");
    const levelSource = resolution || size;
    const resolutions = unique((levelSource?.options || []).map(levelLabel));
    if (resolutions.length) Object.assign(caps, { resolutions, resolution: levelLabel(levelSource.default) || resolutions[0] });
    const ratioSource = ratio || size;
    const ratios = unique((ratioSource?.options || []).map(ratioLabel));
    if (ratios.length) Object.assign(caps, { ratios, ratio: ratioLabel(ratioSource.default) || ratios[0] });
    for (const use of ["images", "videos", "audios"]) {
        const limit = Math.max(0, ...endpointParams.map((params) => params.filter((param) => param.use === use).reduce((sum, param) => sum + param.limit, 0)));
        if (limit) caps[use] = limit;
    }
    if (endpointParams.some((params) => params.some((param) => param.use === "last"))) caps.lastFrame = true;
    if (endpointParams.some((params) => params.some((param) => param.use === "audio"))) caps.audio = true;
    return caps;
}

const families = {};
const endpoints = {};
const sourceParams = {};
for (const model of [...models].sort((a, b) => a.endpoint.localeCompare(b.endpoint))) {
    const kind = modelKind(model);
    if (!kind) continue;
    const params = model.params.map((param) => registryParam(kind, param)).filter((param) => param.use || param.required);
    endpoints[model.endpoint] = params;
    sourceParams[model.endpoint] = model.params;
    const family = (families[familyName(model.endpoint, kind)] ||= {});
    for (const mode of endpointModes(kind, params)) (family[mode] ||= []).push(model.endpoint);
}
for (const modes of Object.values(families)) {
    for (const [mode, list] of Object.entries(modes)) list.sort((a, b) => Number(tokenMode(b) === mode) - Number(tokenMode(a) === mode));
}

const catalog = {};
for (const [name, modes] of Object.entries(families)) {
    const kind = name.split("/").pop();
    if (kind === "tts") {
        const params = endpoints[modes.text[0]];
        const voice = params.find((param) => param.use === "voice");
        const speed = params.find((param) => param.use === "speed");
        const voiceSource = sourceParams[modes.text[0]].find((param) => param.fieldKey === voice?.key);
        catalog[name] = { ...(voice?.type === "LIST" ? { voices: voiceSource.options.map((option) => ({ value: option.value, label: String(option.description || option.value).split("·")[0] })) } : {}), ...(voice?.default ? { voice: voice.default } : {}), ...(speed ? { speed: { min: speed.min ?? 0.5, max: speed.max ?? 2 } } : {}) };
    } else if (kind === "image") {
        catalog[name] = { modes: Object.fromEntries(Object.entries(modes).map(([mode, list]) => [mode, mode === "edit" ? { images: Math.max(...list.map((endpoint) => endpoints[endpoint].filter((param) => param.use === "images").reduce((sum, param) => sum + param.limit, 0))) } : {}])) };
    } else {
        catalog[name] = { modes: Object.fromEntries(Object.entries(modes).map(([mode, list]) => [mode, videoModeCaps(list.map((endpoint) => endpoints[endpoint]))])) };
    }
}

const lines = (object) => `{\n${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(object[key])}`).join(",\n")}\n}`;
writeFileSync(`${root}service/runninghub_registry.json`, `{"families":${lines(families)},\n"endpoints":${lines(endpoints)}}\n`);
writeFileSync(
    `${root}web/src/lib/runninghub-models.ts`,
    `// Generated by scripts/runninghub-registry.mjs from the RunningHub model registry; do not edit.\nimport type { RunningHubModelInfo } from "./runninghub";\n\nexport const runningHubModelCatalog: Record<string, RunningHubModelInfo> = ${lines(catalog)};\n`,
);
console.log(`families=${Object.keys(families).length} endpoints=${Object.keys(endpoints).length}`);
