import { aiApiUrl, aiHeaders, usesAccountProxy, isCompletedTask, isFailedTask, formatErrorDetail, publicHttpUrl } from "./ai-request";
import type { ReferenceImage, ReferenceAudio, ReferenceVideo } from "@/types/media";
import { dataUrlToGeminiInlineData, geminiActionUrl, geminiErrorMessage, geminiOperationUrl, isGeminiConfig, isGeminiVideoModel, isGeminiVeo31Model, normalizeGeminiVideoRatio } from "@/lib/gemini";
import axios from "axios";

import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { isMiniMaxH3BaseModel, isMiniMaxH3Config, miniMaxVideoInputError, miniMaxMediaLimits, miniMaxMediaFormats, MINIMAX_CONTEXT_IR_MODEL, MINIMAX_REGENERATION_MODEL, MINIMAX_REQUEST_MAX_BYTES } from "@/lib/minimax-video";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio } from "@/lib/seedance-video";
import { normalizeVideoConfig, videoDurationRule, videoReferenceMode, normalizeVideoSizeValue, normalizeVideoResolutionValue, isAgnesVideoV25Model, isCogVideoX3Model, modelKey, supportsVideoAudioGeneration, supportsVideoFrameReferences } from "@/lib/video-model-capabilities";
import { resolveMediaUrl, uploadMediaFile, uploadRemoteMediaToServer } from "@/services/file-storage";
import { autoSyncToCloud, imageToDataUrl, resolveImageUrl } from "@/services/image-storage";
import { channelIdForActiveModel, channelProtocolForConfig, localChannelForActiveModel, type AiConfig } from "@/stores/use-config-store";

export type VideoResponse = { id: string; task_id?: string; video_id?: string; source_id?: string; sourceId?: string; channelId?: string; userChannelId?: string; channelName?: string; channel_id?: string; user_channel_id?: string; channel_name?: string; status?: string; video_url?: string; url?: string; storageKey?: string; progress?: number; error?: { message?: string }; size?: string; seconds?: string; model?: string; created_at?: string | number; createdAt?: string | number; started_at?: string | number; startedAt?: string | number; request_body?: string; prompt?: string };
type ApiVideoEnvelope = { code: number; data?: VideoResponse | VideoResponse[] | null; msg?: string; message?: string };
type ApiVideoResponse = VideoResponse | ApiVideoEnvelope;
export type VideoProgressHandler = (progress: number, task: VideoResponse) => void;
export type VideoTaskCreateOptions = { clientTaskId?: string; source?: "video-workbench" | "canvas"; sourceId?: string };
export const VIDEO_POLL_INTERVAL_MS = 5000;
const MINIMAX_POLL_INTERVAL_MS = 10000;
const MINIMAX_PROMPT_MAX_POLLS = 60;

export class VideoRequestError extends Error {
    detail?: string;

    constructor(message: string, detail?: unknown) {
        super(message);
        this.name = "VideoRequestError";
        this.detail = formatErrorDetail(detail);
    }
}

function aiVideoPollUrl(config: AiConfig, model: string, id: string) {
    if (!usesAccountProxy(config) && isGeminiConfig(config, model)) {
        const channel = localChannelForActiveModel(config);
        return geminiOperationUrl(channel?.baseUrl || config.baseUrl, id);
    }
    if (!usesAccountProxy(config) && isMiniMaxH3Config(config, model)) {
        return miniMaxApiUrl(config, `/v2/query/video_generation/${encodeURIComponent(id)}`);
    }
    if (!usesAccountProxy(config) && isCogVideoX3Model(model)) {
        return aiApiUrl(config, `/async-result/${encodeURIComponent(id)}`);
    }
    if (!usesAccountProxy(config) && isArkVideoConfig(config, model)) {
        return aiApiUrl(config, `/contents/generations/tasks/${encodeURIComponent(id)}`);
    }
    if (!isAgnesVideoModel(model) || !id.startsWith("video_")) {
        return aiApiUrl(config, `/videos/${encodeURIComponent(id)}`);
    }
    if (usesAccountProxy(config)) {
        return `/api/v1/videos/${encodeURIComponent(id)}`;
    }
    const channel = localChannelForActiveModel(config);
    const baseUrl = agnesBaseUrl(channel?.baseUrl || config.baseUrl);
    return `${baseUrl}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=${encodeURIComponent(model)}`;
}

function miniMaxApiUrl(config: AiConfig, path: string) {
    const channel = localChannelForActiveModel(config);
    return `${(channel?.baseUrl || config.baseUrl).trim().replace(/\/+$/, "")}${path}`;
}

function agnesBaseUrl(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    return normalized.toLowerCase().endsWith("/v1") ? normalized.slice(0, -3).replace(/\/+$/, "") : normalized;
}

export type VideoReferenceInput = {
    references?: ReferenceImage[];
    videoReferences?: ReferenceVideo[];
    audioReferences?: ReferenceAudio[];
    firstFrame?: ReferenceImage | null;
    lastFrame?: ReferenceImage | null;
    /** A finished MiniMax-H3 768P video to regenerate at 2K together with its original inputs. */
    baseVideo?: ReferenceVideo | null;
};

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: VideoReferenceInput = {}, onProgress?: VideoProgressHandler, options: VideoTaskCreateOptions = {}): Promise<VideoResponse> {
    config = normalizeVideoConfig(config, videoReferenceMode(references));
    const model = config.model || config.videoModel;
    const systemPrompt = (config.systemPrompts.video || config.systemPrompt).trim();
    const body = await createVideoRequestBody(config, model, systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt, normalizeVideoReferenceInput(references));
    try {
        const accountProxy = usesAccountProxy(config);
        const headers = { ...aiHeaders(config), ...(accountProxy && options.clientTaskId ? { "X-Client-Video-Task-ID": options.clientTaskId } : {}), ...(accountProxy && options.source ? { "X-Video-Task-Source": options.source } : {}), ...(accountProxy && options.sourceId ? { "X-Video-Task-Source-ID": options.sourceId } : {}) };
        const channel = localChannelForActiveModel(config);
        const createUrl = !accountProxy && isGeminiConfig(config, model)
            ? geminiActionUrl(channel?.baseUrl || config.baseUrl, model, "predictLongRunning")
            : !accountProxy && isMiniMaxH3Config(config, model)
                ? miniMaxApiUrl(config, references.baseVideo ? "/v2/video_regeneration" : "/v2/video_generation")
                : aiApiUrl(config, accountProxy ? "/videos" : isArkVideoConfig(config, model) ? "/contents/generations/tasks" : isCogVideoX3Model(model) ? "/videos/generations" : "/videos");
        const requestBody = !accountProxy && isGeminiConfig(config, model) ? withoutVideoModel(body) : body;
        const created = unwrapVideoResponseForConfig(config, model, (await axios.post<ApiVideoResponse>(createUrl, requestBody, { headers })).data);
        if (!created.id && !created.video_id) throw new Error("视频接口没有返回任务 ID");
        const task = await syncGeneratedVideo(created, config);
        if (typeof task.progress === "number") onProgress?.(task.progress, task);
        return task;
    } catch (error) {
        const { message, detail } = readAxiosError(error, "视频生成失败");
        throw new VideoRequestError(message, detail);
    }
}

export async function pollVideoGenerationTaskStatus(config: AiConfig, task: VideoResponse) {
    const model = config.model || config.videoModel;
    const pollId = videoPollId(model, task);
    if (!pollId) throw new VideoRequestError("视频接口没有返回任务 ID", task);
    const result = unwrapVideoResponseForConfig(config, model, (await axios.get<ApiVideoResponse>(aiVideoPollUrl(config, model, pollId), { headers: aiHeaders(config), params: usesAccountProxy(config) ? { model } : undefined })).data);
    return syncGeneratedVideo(await cacheProtectedGeminiVideo(config, model, result), config, true);
}

/** MiniMax asks clients to query tasks every 10 seconds; other providers keep the 5-second polling tick. */
export function isVideoPollDue(config: AiConfig, model: string, lastPolledAt?: number, now = Date.now()) {
    return !lastPolledAt || !isMiniMaxH3Config(config, model) || now - lastPolledAt >= MINIMAX_POLL_INTERVAL_MS - VIDEO_POLL_INTERVAL_MS / 2;
}

/** Runs MiniMax H3-Context-IR on the prompt and its frames or references, resolving the enhanced prompt. */
export async function optimizeMiniMaxPrompt(config: AiConfig, prompt: string, references: VideoReferenceInput = {}) {
    config = normalizeVideoConfig(config, videoReferenceMode(references));
    const model = config.model || config.videoModel;
    if (!isMiniMaxH3Config(config, model) || !isMiniMaxH3BaseModel(model)) throw new VideoRequestError("仅 MiniMax 官方渠道的 MiniMax-H3 支持 AI 优化提示词");
    try {
        const accountProxy = usesAccountProxy(config);
        const content = await miniMaxContent(model, prompt, normalizeVideoReferenceInput(references));
        const body = { model: accountProxy ? MINIMAX_CONTEXT_IR_MODEL : model, content, duration: Number(config.videoSeconds), ratio: config.size };
        const createUrl = accountProxy ? aiApiUrl(config, "/videos") : miniMaxApiUrl(config, "/v2/h3_context_ir");
        let task = unwrapVideoResponseForConfig(config, model, (await axios.post<ApiVideoResponse>(createUrl, body, { headers: aiHeaders(config) })).data);
        if (!task.id) throw new VideoRequestError("提示词优化接口没有返回任务 ID", task);
        for (let attempt = 0; attempt < MINIMAX_PROMPT_MAX_POLLS; attempt++) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, MINIMAX_POLL_INTERVAL_MS));
            task = await pollVideoGenerationTaskStatus(config, task);
            if (task.prompt) return task.prompt;
            if (isFailedTask(task.status)) throw new VideoRequestError(task.error?.message || "提示词优化失败", task);
        }
        throw new VideoRequestError("提示词优化超时，请稍后重试", task);
    } catch (error) {
        const { message, detail } = readAxiosError(error, "提示词优化失败");
        throw new VideoRequestError(message, detail);
    }
}

function videoSyncKey(config: AiConfig, task: VideoResponse) {
    const channelId = config.channelMode === "remote" ? channelIdForActiveModel(config) : localChannelForActiveModel(config)?.id;
    return `${config.channelMode}:${channelId || config.baseUrl}:${task.id}:${task.task_id || ""}:${task.video_id || ""}`;
}

async function syncGeneratedVideo(task: VideoResponse, config: AiConfig, contentResolved = false): Promise<VideoResponse> {
    const url = task.video_url || task.url || "";
    if (task.storageKey || isFailedTask(task.status) || (!isCompletedTask(task.status) && !url)) return task;
    const media = await autoSyncToCloud(`video:${videoSyncKey(config, task)}`, async () => {
        const cached = contentResolved ? task : await cacheProtectedGeminiVideo(config, config.model || config.videoModel, task);
        if (cached.storageKey) return { url: cached.video_url || cached.url || url, storageKey: cached.storageKey };
        return url ? uploadRemoteMediaToServer(url, "video") : null;
    });
    return media ? { ...task, url: media.url, video_url: media.url, storageKey: media.storageKey } : task;
}

export async function listVideoGenerationTasks(config: AiConfig) {
    if (!usesAccountProxy(config)) return [];
    const payload = (await axios.get<ApiVideoEnvelope>("/api/v1/video-tasks", { headers: aiHeaders(config) })).data;
    if (payload.code !== 0) throw new VideoRequestError(payload.msg || payload.message || "读取视频任务失败", payload);
    return Array.isArray(payload.data) ? payload.data.map(normalizeVideoResponse) : [];
}

export async function deleteVideoGenerationTask(config: AiConfig, task?: VideoResponse | null) {
    if (!usesAccountProxy(config) || !task) return;
    const id = task.id || task.task_id || task.video_id;
    if (!id) return;
    const payload = (await axios.delete<ApiVideoEnvelope>(`/api/v1/video-tasks/${encodeURIComponent(id)}`, { headers: aiHeaders(config) })).data;
    if (payload.code !== 0) throw new VideoRequestError(payload.msg || payload.message || "删除视频任务失败", payload);
}

async function createAgnesVideoV25RequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    const hasFrames = Boolean(input.firstFrame || input.lastFrame);
    const hasReferences = Boolean(input.references.length || input.videoReferences.length || input.audioReferences.length);
    if (hasFrames && hasReferences) throw new VideoRequestError("Agnes Video 2.5 的首尾帧不能和普通参考素材同时使用");

    const ratio = config.size;
    const body: Record<string, unknown> = {
        model,
        prompt,
        mode: hasFrames ? "keyframe" : hasReferences ? "reference" : "text",
        seconds: config.videoSeconds,
        size: "720P",
        aspect_ratio: ratio === "adaptive" ? "16:9" : ratio,
    };
    if (input.firstFrame) body.first_frame = await agnesVideoV25ReferenceUrl(input.firstFrame);
    if (input.lastFrame) body.last_frame = await agnesVideoV25ReferenceUrl(input.lastFrame);
    if (input.references.length) body.images = await Promise.all(input.references.map(agnesVideoV25ReferenceUrl));
    if (input.audioReferences.length) body.audios = await Promise.all(input.audioReferences.map(agnesVideoV25ReferenceUrl));
    if (input.videoReferences.length) {
        const urls = await Promise.all(input.videoReferences.map(agnesVideoV25ReferenceUrl));
        body.videos = urls.map((url) => ({ url }));
    }
    return body;
}

async function createVideoRequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    if (input.baseVideo && !(isMiniMaxH3Config(config, model) && isMiniMaxH3BaseModel(model))) throw new VideoRequestError("仅 MiniMax 官方渠道的 MiniMax-H3 支持 2K 重生成");
    if (isArkVideoConfig(config, model)) return createArkSeedanceVideoRequestBody(config, model, prompt, input);
    const size = normalizeVideoSizeValue(config.size);
    if (isGeminiVideoModel(model) && isGeminiConfig(config, model)) return createGeminiVeoRequestBody(config, model, prompt, input);
    if (isMiniMaxH3Config(config, model)) return createMiniMaxH3VideoRequestBody(config, model, prompt, input);
    if (isCogVideoX3Model(model)) return createCogVideoX3RequestBody(config, model, prompt, input);
    if (isAgnesVideoV25Model(model)) return createAgnesVideoV25RequestBody(config, model, prompt, input);
    if (!supportsVideoFrameReferences(model, channelProtocolForConfig(config)) && (input.firstFrame || input.lastFrame)) {
        input = { ...input, references: [...input.references, ...[input.firstFrame, input.lastFrame].filter((image): image is ReferenceImage => Boolean(image))], firstFrame: null, lastFrame: null };
    }
    if (isAgnesVideoModel(model)) {
        const references = input.references;
        const inputReferences = await Promise.all(references.slice(0, 7).map(imageToAgnesReference));
        const dimensions = size !== "auto" ? parseVideoDimensions(size) : null;
        const frameRate = agnesFrameRate(config.videoSeconds);
        const body: Record<string, unknown> = {
            model,
            prompt,
            num_frames: agnesNumFrames(config.videoSeconds, frameRate),
            frame_rate: frameRate,
        };
        if (dimensions) {
            body.width = dimensions.width;
            body.height = dimensions.height;
        }
        if (inputReferences.length === 1) body.image = inputReferences[0];
        if (inputReferences.length > 1) body.extra_body = { image: inputReferences, mode: "keyframes" };
        return body;
    }

    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    if (!isGeminiOmniFlashVideoModel(model)) {
        body.append("seconds", config.videoSeconds);
    }
    if (isSeedanceVideoConfig(config)) body.append("size", normalizeSeedanceRatio(config.size));
    else if (size !== "auto") body.append("size", size);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    if (supportsVideoAudioGeneration(model)) body.append("video_generate_audio", String(boolConfig(config.videoGenerateAudio, false)));
    const images = await Promise.all(input.references.slice(0, 9).map(imageReferenceToFormValue));
    images.forEach((file) => body.append("input_reference[]", file));
    if (input.firstFrame) body.append("first_frame_url", await imageReferenceToFormValue(input.firstFrame));
    if (input.lastFrame) body.append("last_frame_url", await imageReferenceToFormValue(input.lastFrame));
    const videos = await Promise.all(input.videoReferences.map(mediaReferenceToFormValue));
    videos.forEach((file) => body.append("video_reference[]", file));
    const audios = await Promise.all(input.audioReferences.map(mediaReferenceToFormValue));
    audios.forEach((file) => body.append("audio_reference[]", file));
    return body;
}

function isArkVideoConfig(config: AiConfig, model: string) {
    return channelProtocolForConfig({ ...config, model, videoModel: model }) === "ark";
}

async function createArkSeedanceVideoRequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    const [images, firstFrame, lastFrame, videos, audios] = await Promise.all([
        Promise.all(input.references.map(imageToAgnesReference)),
        input.firstFrame ? imageToAgnesReference(input.firstFrame) : "",
        input.lastFrame ? imageToAgnesReference(input.lastFrame) : "",
        Promise.all(input.videoReferences.map(arkMediaReferenceUrl)),
        Promise.all(input.audioReferences.map(arkMediaReferenceUrl)),
    ]);
    const image = (url: string, role: string) => ({ type: "image_url", image_url: { url }, role });
    return {
        model,
        content: [
            { type: "text", text: prompt },
            ...images.map((url) => image(url, "reference_image")),
            ...(firstFrame ? [image(firstFrame, "first_frame")] : []),
            ...(lastFrame ? [image(lastFrame, "last_frame")] : []),
            ...videos.map((url) => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
            ...audios.map((url) => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
        ],
        duration: normalizeSeedanceDuration(config.videoSeconds, videoDurationRule(config).max),
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeVideoResolution(config.vquality),
        generate_audio: boolConfig(config.videoGenerateAudio, false),
        watermark: boolConfig(config.videoWatermark, false),
    };
}

async function arkMediaReferenceUrl(media: ReferenceVideo | ReferenceAudio) {
    const url = publicHttpUrl(await resolveMediaUrl(media.storageKey, media.url)) || publicHttpUrl(media.url);
    if (!url) throw new VideoRequestError("火山方舟的参考视频和参考音频需要方舟服务器能够访问的 URL");
    return url;
}

async function createMiniMaxH3VideoRequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    const content = await miniMaxContent(model, prompt, input);
    const body: Record<string, unknown> = input.baseVideo
        ? { model: usesAccountProxy(config) ? MINIMAX_REGENERATION_MODEL : model, resolution: "2K", content: [...content, { type: "video_url", video_url: { url: await miniMaxBaseVideoUrl(input.baseVideo) }, role: "base_video" }] }
        : { model, content, resolution: config.vquality, duration: Number(config.videoSeconds), ratio: config.size };
    if (boolConfig(config.videoWatermark, false)) body.aigc_watermark = true;
    if (new Blob([JSON.stringify(body)]).size > MINIMAX_REQUEST_MAX_BYTES) throw new VideoRequestError("MiniMax 请求体不能超过 64MB，请使用公网素材地址");
    return body;
}

async function miniMaxBaseVideoUrl(video: ReferenceVideo) {
    const url = publicHttpUrl(await resolveMediaUrl(video.storageKey, video.url)) || publicHttpUrl(video.url);
    if (!url) throw new VideoRequestError("2K 重生成需要可公网访问的视频地址，请先同步到云端");
    return url;
}

/** Builds the shared MiniMax content array used by video generation, Context-IR and regeneration. */
async function miniMaxContent(model: string, prompt: string, input: Required<VideoReferenceInput>) {
    const hasFrames = Boolean(input.firstFrame || input.lastFrame);
    const hasReferences = Boolean(input.references.length || input.videoReferences.length || input.audioReferences.length);
    const inputError = miniMaxVideoInputError(model, prompt, input);
    if (inputError) throw new VideoRequestError(inputError);

    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (hasFrames) {
        const frames = [
            { reference: input.firstFrame, role: "first_frame" },
            { reference: input.lastFrame, role: "last_frame" },
        ].filter((item): item is { reference: ReferenceImage; role: string } => Boolean(item.reference));
        const urls = await Promise.all(frames.map((item) => miniMaxReferenceValue(imageReferenceToFormValue(item.reference), "image")));
        frames.forEach((item, index) => content.push({ type: "image_url", image_url: { url: urls[index] }, role: item.role }));
    } else if (hasReferences) {
        const [images, videos, audios] = await Promise.all([
            Promise.all(input.references.map((reference) => miniMaxReferenceValue(imageReferenceToFormValue(reference), "image"))),
            Promise.all(input.videoReferences.map((reference) => miniMaxReferenceValue(mediaReferenceToFormValue(reference), "video"))),
            Promise.all(input.audioReferences.map((reference) => miniMaxReferenceValue(mediaReferenceToFormValue(reference), "audio"))),
        ]);
        images.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
        videos.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
        audios.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    }
    return content;
}

async function miniMaxReferenceValue(value: Promise<string | File>, kind: keyof typeof miniMaxMediaLimits) {
    const reference = await value;
    if (reference instanceof File && !miniMaxMediaFormats[kind].includes(reference.type.toLowerCase())) throw new VideoRequestError("MiniMax 参考素材格式不支持");
    if (reference instanceof File && reference.size > miniMaxMediaLimits[kind]) throw new VideoRequestError(`MiniMax 参考素材超过 ${miniMaxMediaLimits[kind] / 1024 / 1024}MB`);
    if (kind === "video" && reference instanceof File && reference.type !== "video/mp4") throw new VideoRequestError("MiniMax 本地视频仅支持 MP4；MOV 请使用公网地址");
    return typeof reference === "string" ? reference : readFileAsDataUrl(reference);
}

async function createCogVideoX3RequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    if (input.videoReferences.length || input.audioReferences.length) throw new VideoRequestError("CogVideoX-3 不支持参考视频或参考音频");
    const frames = [input.firstFrame, input.lastFrame].filter((frame): frame is ReferenceImage => Boolean(frame));
    const references = (frames.length ? frames : input.references).slice(0, 2);
    const imageUrls = await Promise.all(references.map(imageToDataUrl));
    return {
        model,
        prompt,
        quality: normalizeVideoResolution(config.vquality) === "480p" ? "speed" : "quality",
        size: config.size,
        duration: Number(config.videoSeconds),
        with_audio: boolConfig(config.videoGenerateAudio, false),
        ...(imageUrls.length ? { image_url: imageUrls.length === 1 ? imageUrls[0] : imageUrls } : {}),
    };
}

function normalizeVideoReferenceInput(input: VideoReferenceInput): Required<VideoReferenceInput> {
    return { references: input.references || [], videoReferences: input.videoReferences || [], audioReferences: input.audioReferences || [], firstFrame: input.firstFrame || null, lastFrame: input.lastFrame || null, baseVideo: input.baseVideo || null };
}

async function imageReferenceToFormValue(image: ReferenceImage) {
    const resolvedUrl = await resolveImageUrl(image.storageKey, "");
    for (const url of [image.url, resolvedUrl, image.dataUrl]) {
        const publicUrl = publicHttpUrl(url);
        if (publicUrl) return publicUrl;
    }
    return dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) });
}

async function mediaReferenceToFile(media: ReferenceVideo | ReferenceAudio) {
    const url = await resolveMediaUrl(media.storageKey, media.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`参考素材读取失败：${response.status}`);
    const blob = await response.blob();
    return new File([blob], media.name || "reference", { type: media.type || blob.type || "application/octet-stream" });
}

async function mediaReferenceToFormValue(media: ReferenceVideo | ReferenceAudio) {
    const resolvedUrl = await resolveMediaUrl(media.storageKey, media.url);
    const publicUrl = publicHttpUrl(resolvedUrl) || publicHttpUrl(media.url);
    if (publicUrl) return publicUrl;
    return mediaReferenceToFile(media);
}

async function imageToAgnesReference(image: ReferenceImage) {
    const resolvedUrl = await resolveImageUrl(image.storageKey, "");
    for (const url of [image.dataUrl, image.url, resolvedUrl]) {
        const publicUrl = publicHttpUrl(url);
        if (publicUrl) return publicUrl;
    }
    return imageToDataUrl(image);
}

async function agnesVideoV25ReferenceUrl(reference: ReferenceImage | ReferenceVideo | ReferenceAudio) {
    const resolvedUrl = "dataUrl" in reference
        ? await resolveImageUrl(reference.storageKey, reference.url || "")
        : await resolveMediaUrl(reference.storageKey, reference.url);
    const url = publicHttpUrl(reference.url) || ("dataUrl" in reference ? publicHttpUrl(reference.dataUrl) : "") || publicHttpUrl(resolvedUrl);
    if (!url) throw new VideoRequestError("Agnes Video 2.5 的参考素材必须具有公网访问地址");
    return url;
}

function agnesFrameRate(secondsValue: string) {
    const seconds = Number(normalizeVideoSeconds(secondsValue));
    return seconds > 18 ? Math.max(1, Math.floor(440 / seconds)) : 24;
}

function agnesNumFrames(secondsValue: string, frameRate: number) {
    const target = Math.round(Number(normalizeVideoSeconds(secondsValue)) * frameRate) + 1;
    const capped = Math.min(441, Math.max(9, target));
    return capped - ((capped - 1) % 8);
}

function isAgnesVideoModel(model: string) {
    return model.toLowerCase().includes("agnes-video");
}

function videoPollId(model: string, task: VideoResponse) {
    return isAgnesVideoModel(model) ? task.video_id || task.id : task.id || task.task_id || task.video_id || "";
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(30, seconds)));
}

function isGeminiOmniFlashVideoModel(model: string) {
    return modelKey(model) === "gemini-omni-flash-preview";
}

function parseVideoDimensions(size: string) {
    const match = size.match(/^(\d+)x(\d+)$/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function normalizeVideoResolution(value: string) {
    const resolution = normalizeVideoResolutionValue(value);
    return resolution.endsWith("k") ? resolution : `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse): VideoResponse {
    if (!payload) throw new Error("接口没有返回视频任务");
    if (isVideoEnvelope(payload)) {
        if (payload.code !== 0) throw new VideoRequestError(payload.msg || payload.message || "请求失败", payload);
        if (!payload.data || Array.isArray(payload.data)) throw new Error("接口没有返回视频任务");
        return normalizeVideoResponse(payload.data);
    }
    const error = videoPayloadErrorMessage(payload);
    if (error) throw new VideoRequestError(error, payload);
    if (payload.error?.message) throw new VideoRequestError(payload.error.message, payload);
    return normalizeVideoResponse(payload);
}

function unwrapVideoResponseForConfig(config: AiConfig, model: string, payload: ApiVideoResponse) {
    if (isGeminiVideoModel(model) && isGeminiConfig(config, model)) return normalizeGeminiVideoResponse(payload);
    if (!isVideoEnvelope(payload) && isArkVideoConfig(config, model)) {
        const root = payload as unknown as Record<string, unknown>;
        const message = nestedMessage(root.error);
        const status = firstString(root.status).toLowerCase();
        return normalizeVideoResponse({ ...root, status: message || status === "expired" ? "failed" : status, error: message ? { message } : undefined });
    }
    if (isMiniMaxH3Config(config, model)) {
        const root = payload as unknown as Record<string, unknown>;
        const task = root.task && typeof root.task === "object" ? root.task as Record<string, unknown> : null;
        if (task) {
            const content = task.content && typeof task.content === "object" ? task.content as Record<string, unknown> : {};
            const videoUrl = firstString(content.url, task.video_url);
            const prompt = firstString(content.prompt);
            if (isCompletedTask(firstString(task.status)) && !videoUrl && !prompt) throw new VideoRequestError("MiniMax 视频生成完成但没有返回视频地址", payload);
            return normalizeVideoResponse({
                ...task,
                task_id: firstString(task.id),
                video_url: videoUrl,
                prompt: prompt || undefined,
                seconds: task.duration == null ? undefined : String(task.duration),
                size: firstString(task.ratio, task.size),
            });
        }
    }
    return unwrapVideoResponse(payload);
}

async function createGeminiVeoRequestBody(config: AiConfig, model: string, prompt: string, input: Required<VideoReferenceInput>) {
    if (input.videoReferences.length) throw new VideoRequestError("Gemini Veo 不支持普通参考视频，请移除后重试");
    if (input.audioReferences.length) throw new VideoRequestError("Gemini Veo 不支持参考音频，请移除后重试");
    if (input.lastFrame && !input.firstFrame) throw new VideoRequestError("请先添加首帧图片");
    const hasFrames = Boolean(input.firstFrame || input.lastFrame);
    if (hasFrames && input.references.length) throw new VideoRequestError("首尾帧模式不能与普通参考图同时使用");
    if ((input.lastFrame || input.references.length) && !isGeminiVeo31Model(model)) throw new VideoRequestError("当前 Veo 模型不支持尾帧或普通参考图");
    if (input.references.length > 3) throw new VideoRequestError("Veo 3.1 参考图最多 3 张");

    const instance: Record<string, unknown> = { prompt };
    if (input.firstFrame) instance.image = dataUrlToGeminiInlineData(await imageToDataUrl(input.firstFrame));
    if (input.lastFrame) instance.lastFrame = dataUrlToGeminiInlineData(await imageToDataUrl(input.lastFrame));
    if (input.references.length) {
        const images = await Promise.all(input.references.map(imageToDataUrl));
        instance.referenceImages = images.map((image) => ({ image: dataUrlToGeminiInlineData(image), referenceType: "asset" }));
    }
    const aspectRatio = normalizeGeminiVideoRatio(config.size);
    return {
        model,
        instances: [instance],
        parameters: {
            ...(aspectRatio ? { aspectRatio } : {}),
            durationSeconds: config.videoSeconds,
            resolution: config.vquality,
        },
    };
}

function normalizeGeminiVideoResponse(payload: ApiVideoResponse): VideoResponse {
    const root = payload as unknown as Record<string, unknown>;
    if (typeof root.code === "number") return unwrapVideoResponse(payload);
    const name = firstString(root.name);
    const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
    const videoUrl = geminiVideoUri(root);
    const done = root.done === true;
    return normalizeVideoResponse({
        ...root,
        id: name,
        task_id: name,
        status: Object.keys(error).length ? "failed" : done && videoUrl ? "completed" : done ? "failed" : "processing",
        progress: done ? 100 : 0,
        video_url: videoUrl,
        error: Object.keys(error).length ? { message: geminiErrorMessage(root, "视频生成失败") } : done && !videoUrl ? { message: "Gemini Veo 任务完成但没有返回视频地址" } : undefined,
    });
}

function geminiVideoUri(value: unknown, depth = 0): string {
    if (depth > 8 || value == null) return "";
    if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
    if (Array.isArray(value)) return value.map((item) => geminiVideoUri(item, depth + 1)).find(Boolean) || "";
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const direct = firstString(record.uri, record.videoUri, record.video_url, record.url);
    if (/^https?:\/\//.test(direct)) return direct;
    for (const item of Object.values(record)) {
        const found = geminiVideoUri(item, depth + 1);
        if (found) return found;
    }
    return "";
}

async function cacheProtectedGeminiVideo(config: AiConfig, model: string, task: VideoResponse) {
    const url = task.video_url || task.url || "";
    if (!isGeminiConfig(config, model) || !isCompletedTask(task.status) || task.storageKey || !url) return task;
    const localTaskId = task.id || task.task_id || "";
    const response = await fetch(
        usesAccountProxy(config) ? `${aiApiUrl(config, `/videos/${encodeURIComponent(localTaskId)}/content`)}?model=${encodeURIComponent(model)}` : url,
        { headers: aiHeaders(config) },
    );
    if (!response.ok) throw new VideoRequestError(`视频内容下载失败：${response.status}`, task);
    const media = await uploadMediaFile(await response.blob(), "generated-video", `video-content:${videoSyncKey(config, task)}`);
    return { ...task, url: media.url, video_url: media.url, storageKey: media.storageKey };
}

function withoutVideoModel(body: FormData | Record<string, unknown>) {
    if (body instanceof FormData) return body;
    const { model: _model, ...nativeBody } = body;
    return nativeBody;
}

function isVideoEnvelope(payload: ApiVideoResponse): payload is ApiVideoEnvelope {
    return "code" in payload && typeof payload.code === "number";
}

function readAxiosError(error: unknown, fallback: string) {
    if (error instanceof VideoRequestError) return { message: error.message, detail: error.detail || error.stack || error.message };
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return { message: responseData?.msg || responseData?.error?.message || (error.response?.status ? `${fallback}：${error.response.status}` : fallback), detail: responseData || error.message };
    }
    return { message: error instanceof Error ? error.message : fallback, detail: error instanceof Error ? error.stack || error.message : error };
}

function normalizeVideoResponse(value: unknown): VideoResponse {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const id = firstString(record.id, record.request_id, record.task_id, record.video_id, firstTaskId(record));
    return {
        ...(record as VideoResponse),
        id,
        task_id: firstString(record.task_id, record.id),
        video_id: firstString(record.video_id),
        source_id: firstString(record.source_id, record.sourceId),
        sourceId: firstString(record.sourceId, record.source_id),
        channelId: firstString(record.channelId, record.channel_id),
        userChannelId: firstString(record.userChannelId, record.user_channel_id),
        channelName: firstString(record.channelName, record.channel_name),
        status: firstString(record.status, record.state, record.task_status),
        video_url: firstString(record.video_url, record.videoUrl, record.remixed_from_video_id, record.output_url, record.download_url, firstVideoUrl(record)),
        progress: typeof record.progress === "number" ? record.progress : (typeof record.progress === "string" ? parseFloat(record.progress) : undefined),
    };
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && !!value.trim())?.trim() || "";
}

function videoPayloadErrorMessage(value: unknown): string {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    if (typeof record.code === "number" && record.code !== 0) return firstString(record.msg, record.message, nestedMessage(record.error)) || "视频下载失败";
    if (typeof record.code === "string" && /fail|error/i.test(record.code)) return firstString(nestedMessage(record.error), record.msg, record.message, record.code);
    return firstString(nestedMessage(record.error));
}

function nestedMessage(value: unknown) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return firstString((value as Record<string, unknown>).message);
}

function firstVideoUrl(value: unknown, depth = 0): string {
    if (depth > 5 || value == null) return "";
    if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstVideoUrl(item, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const direct = firstString(record.video_url, record.videoUrl, record.url, record.remixed_from_video_id, record.output_url, record.download_url, record.file_url);
    if (/^https?:\/\//.test(direct)) return direct;
    for (const key of ["video_result", "video", "data", "output", "result", "content", "metadata"]) {
        const found = firstVideoUrl(record[key], depth + 1);
        if (found) return found;
    }
    return "";
}

function firstTaskId(value: unknown, depth = 0): string {
    if (depth > 4 || value == null) return "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstTaskId(item, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const direct = firstString(record.id, record.request_id, record.task_id, record.video_id);
    if (direct) return direct;
    for (const key of ["data", "result", "output", "video"]) {
        const found = firstTaskId(record[key], depth + 1);
        if (found) return found;
    }
    return "";
}


export function isCompletedVideoTask(task: VideoResponse) {
    return Boolean(task.video_url || task.url) || isCompletedTask(task.status);
}
