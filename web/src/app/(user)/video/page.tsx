"use client";

import type { ReferenceImage, ReferenceAudio, ReferenceVideo } from "@/types/media";
"use client";
import axios from "axios";

import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, CheckSquare, ChevronDown, ChevronUp, ClipboardPaste, CloudUpload, Copy, Download, FolderPlus, History, LoaderCircle, Music2, PanelBottom, PanelLeft, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Checkbox, Empty, Input, Modal, Switch, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { isFailedTask, usesAccountProxy } from "@/services/api/ai-request";
import { VideoSettingsPanel, videoResolutionLabel, videoResolutionOptions, videoSizeForResolution, videoSizeOptions } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { isRunningHubConfig, runningHubPromptOptional, runningHubVideoInputError, RUNNINGHUB_PROMPT_OPTIMIZE_MODEL } from "@/lib/runninghub";
import { isMiniMaxH3BaseModel, isMiniMaxH3Config, MINIMAX_REGENERATION_MODEL, miniMaxVideoCapabilities, miniMaxVideoInputError, miniMaxRatioOptions, normalizeMiniMaxH3Duration, normalizeMiniMaxH3Resolution, normalizeMiniMaxH3Ratio } from "@/lib/minimax-video";
import { ARK_SEEDANCE_REFERENCE_LIMITS, boolConfig, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { modelKey, normalizeVideoConfig, normalizeVideoResolutionValue, videoDurationRule, videoParameterOptions, videoReferenceMode, isAgnesVideoV25Model, supportsVideoAudioGeneration, supportsVideoFrameReferences } from "@/lib/video-model-capabilities";
import { deleteStoredMedia, downloadRemoteMedia, resolveMediaUrl, uploadMediaFile, uploadRemoteMediaToServer } from "@/services/file-storage";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteVideoGenerationLogs, fetchVideoGenerationLogs, saveVideoGenerationLogs } from "@/services/api/generation-logs";
import { isCompletedVideoTask, createVideoGenerationTask, deleteVideoGenerationTask, isVideoPollDue, listVideoGenerationTasks, optimizeMiniMaxPrompt, pollVideoGenerationTaskStatus, VIDEO_POLL_INTERVAL_MS, VideoRequestError, type VideoResponse } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { channelProtocolForConfig, normalizeLocalChannels, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";


type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    taskLogId?: string;
    createdAt: number;
    prompt: string;

    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    firstFrame?: ReferenceImage | null;
    lastFrame?: ReferenceImage | null;
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    baseVideo?: ReferenceVideo | null;
    taskCount?: number;
    durationMs?: number;
    progress?: number;
    task?: VideoResponse;
    video?: GeneratedVideo;
    error?: string;
    errorDetail?: string;
    lastPolledAt?: number;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    firstFrame?: ReferenceImage | null;
    lastFrame?: ReferenceImage | null;
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    /** Base video of a MiniMax 2K regeneration, kept so retries regenerate instead of starting over. */
    baseVideo?: ReferenceVideo | null;
    taskCount?: number;
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoResponse;
    video?: GeneratedVideo;
    error?: string;
    errorDetail?: string;
    lastPolledAt?: number;
};

type GenerationLogConfig = Pick<AiConfig, "channelMode" | "activeChannelId" | "videoChannelId" | "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
type WorkbenchLayout = "side" | "bottom";
type AssetPickerTarget = "general" | "image" | "video" | "audio" | "firstFrame" | "lastFrame";

const WORKBENCH_LAYOUT_KEY = "infinite-canvas:video-workbench-layout";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
export default function VideoPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const firstFrameInputRef = useRef<HTMLInputElement>(null);
    const lastFrameInputRef = useRef<HTMLInputElement>(null);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateVideoConfig = useCallback<UpdateAiConfig>((key, value) => {
        if (key === "size") {
            updateConfig("videoSize", String(value));
            return;
        }
        updateConfig(key, value);
    }, [updateConfig]);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const token = useUserStore((state) => state.token);
    const isUserReady = useUserStore((state) => state.isReady);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [firstFrame, setFirstFrame] = useState<ReferenceImage | null>(null);
    const [lastFrame, setLastFrame] = useState<ReferenceImage | null>(null);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [optimizingPrompt, setOptimizingPrompt] = useState(false);
    const [workbenchLayout, setWorkbenchLayoutState] = useState<WorkbenchLayout>("side");
    const [bottomSettingsCollapsed, setBottomSettingsCollapsed] = useState(true);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [assetPickerTarget, setAssetPickerTarget] = useState<AssetPickerTarget>("general");
    const [now, setNow] = useState(Date.now());
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [taskCount, setTaskCount] = useState(1);
    const [syncingVideoIds, setSyncingVideoIds] = useState<string[]>([]);
    const pollingLogIdsRef = useRef(new Set<string>());
    const logsRef = useRef<GenerationLog[]>([]);

    const videoConfig = useMemo(() => buildVideoConfig({ ...effectiveConfig, size: effectiveConfig.videoSize }, effectiveConfig.videoModel || effectiveConfig.model, videoReferenceMode({ firstFrame, lastFrame, references, videoReferences, audioReferences })), [effectiveConfig, firstFrame, lastFrame, references, videoReferences, audioReferences]);
    useEffect(() => {
        if (effectiveConfig.videoSize !== videoConfig.size) updateConfig("videoSize", videoConfig.size);
        if (effectiveConfig.vquality !== videoConfig.vquality) updateConfig("vquality", videoConfig.vquality);
        if (effectiveConfig.videoSeconds !== videoConfig.videoSeconds) updateConfig("videoSeconds", videoConfig.videoSeconds);
        if (effectiveConfig.videoGenerateAudio !== videoConfig.videoGenerateAudio) updateConfig("videoGenerateAudio", videoConfig.videoGenerateAudio);
    }, [effectiveConfig.videoSize, effectiveConfig.vquality, effectiveConfig.videoSeconds, effectiveConfig.videoGenerateAudio, videoConfig.size, videoConfig.vquality, videoConfig.videoSeconds, videoConfig.videoGenerateAudio, updateConfig]);
    const effectiveConfigRef = useRef(videoConfig);
    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim()) || runningHubPromptOptional(videoConfig, model);
    const pendingCount = results.filter((item) => item.status === "pending").length;
    const referenceLimits = seedanceReferenceLimits(videoConfig, model);
    const referenceImageLimit = referenceLimits.images;
    const videoReferenceLimit = referenceLimits.videos;
    const pendingLogCount = logs.filter((log) => log.status === "生成中" && log.task && !log.video).length;

    const restorePendingLogResults = (sourceLogs: GenerationLog[]) => {
        const pendingLogs = sourceLogs.filter((log) => log.status === "生成中" && log.task && !log.video);
        if (!pendingLogs.length) return;
        setResults((value) => mergePendingLogResults(value, pendingLogs));
    };

    const pollPendingLogsOnce = (sourceLogs: GenerationLog[]) => {
        const pendingLogs = sourceLogs.filter((log) => log.status === "生成中" && log.task && !log.video);
        if (!pendingLogs.length) return;
        pendingLogs.forEach((log) => {
            if (pollingLogIdsRef.current.has(log.id)) return;
            const resumeConfig = buildResumeVideoConfig(effectiveConfigRef.current, log);
            const taskId = videoLogTaskId(log);
            if (!taskId || !isAiConfigReady(resumeConfig, log.model) || !isVideoPollDue(resumeConfig, log.model, log.lastPolledAt)) return;
            if (isLocalClientVideoLog(log) && !usesAccountProxy(resumeConfig)) return;
            void pollPendingLogOnce(log, resumeConfig);
        });
    };

    useEffect(() => {
        if (!pendingCount && !pendingLogCount) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [pendingCount, pendingLogCount]);

    useEffect(() => {
        if (!pendingLogCount) return;
        const timer = window.setInterval(() => {
            pollPendingLogsOnce(logsRef.current);
        }, VIDEO_POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [pendingLogCount]);

    useEffect(() => {
        void refreshLogs().then((items) => syncBackendVideoTasks(items));
        try {
            const storedLayout = window.localStorage?.getItem(WORKBENCH_LAYOUT_KEY);
            if (storedLayout === "side" || storedLayout === "bottom") setWorkbenchLayoutState(storedLayout);
        } catch {
            // Keep the default layout when localStorage is unavailable.
        }
    }, []);

    useEffect(() => {
        logsRef.current = logs;
    }, [logs]);

    useEffect(() => {
        effectiveConfigRef.current = videoConfig;
    }, [videoConfig]);

    useEffect(() => {
        restorePendingLogResults(logs);
    }, [logs]);

    useEffect(() => {
        if (!isUserReady || !token) return;
        void loadAccountVideoHistory(token).then((items) => syncBackendVideoTasks(items || logsRef.current));
    }, [isUserReady, token]);

    const setWorkbenchLayout = (layout: WorkbenchLayout) => {
        setWorkbenchLayoutState(layout);
        try {
            window.localStorage?.setItem(WORKBENCH_LAYOUT_KEY, layout);
        } catch {
            // Keep the in-memory layout when localStorage is unavailable.
        }
    };

    const pastePromptFromClipboard = async () => {
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (!text) {
                message.error("剪切板里没有可读取的文本");
                return;
            }
            setPrompt(text);
            message.success("已读取剪切板文本");
        } catch {
            message.error("剪切板里没有可读取的文本");
        }
    };

    const openAssetPicker = (target: AssetPickerTarget = "general") => {
        setAssetPickerTarget(target);
        setAssetPickerOpen(true);
    };

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/") && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考素材，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, Math.max(0, referenceImageLimit - references.length));
        const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/") && file.size <= referenceLimits.videoMaxBytes).slice(0, Math.max(0, videoReferenceLimit - videoReferences.length));
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, referenceLimits.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => file.type.startsWith("video/") && file.size > referenceLimits.videoMaxBytes)) message.warning(`已忽略超过 ${referenceLimits.videoMaxBytes / 1024 / 1024}MB 的参考视频`);
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        const hideLoading = imageFiles.length ? message.loading("正在上传参考图...", 0) : null;
        try {
            const nextReferences = await Promise.all(
                imageFiles.map(async (file) => {
                    const image = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
                }),
            );
            const nextVideoReferences = await Promise.all(
                videoFiles.map(async (file) => {
                    const video = await uploadMediaFile(file, "video-reference");
                    return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
                }),
            );
            const nextAudioReferences = filterAudioReferencesByDuration(
                audioReferences,
                await Promise.all(
                    audioFiles.map(async (file) => {
                        const audio = await uploadMediaFile(file, "audio-reference");
                        return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, bytes: audio.bytes, durationMs: audio.durationMs };
                    }),
                ),
                referenceLimits,
                message.warning,
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, referenceImageLimit));
            setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, videoReferenceLimit));
            setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, referenceLimits.audios));
            if (nextReferences.length) message.success(`已上传 ${nextReferences.length} 张参考图`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考素材上传失败");
        } finally {
            hideLoading?.();
        }
    };

    const uploadFrameReference = async (slot: "first" | "last", files?: FileList | null) => {
        const file = Array.from(files || []).find((item) => item.type.startsWith("image/"));
        if (!file) {
            message.error("请选择首尾帧图片");
            return;
        }
        if (file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes) {
            message.warning("已忽略超过 30MB 的首尾帧图片");
            return;
        }
        const hideLoading = message.loading(slot === "first" ? "正在上传首帧..." : "正在上传尾帧...", 0);
        try {
            const image = await uploadImage(file);
            const next = { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
            slot === "first" ? setFirstFrame(next) : setLastFrame(next);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "首尾帧上传失败");
        } finally {
            hideLoading();
        }
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, referenceImageLimit - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, referenceImageLimit));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const setFrameFromClipboard = async (slot: "first" | "last") => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            const blob = blobs[0];
            if (!blob) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            if (blob.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes) {
                message.warning("已忽略超过 30MB 的首尾帧图片");
                return;
            }
            const hideLoading = message.loading(slot === "first" ? "正在读取首帧..." : "正在读取尾帧...", 0);
            try {
                const image = await uploadImage(blob);
                const next = { id: nanoid(), name: slot === "first" ? "clipboard-first-frame.png" : "clipboard-last-frame.png", type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
                slot === "first" ? setFirstFrame(next) : setLastFrame(next);
                message.success(slot === "first" ? "已读取首帧" : "已读取尾帧");
            } finally {
                hideLoading();
            }
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const addVideoReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("video/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的视频");
                return;
            }
            const usable = blobs.filter((blob) => blob.size <= referenceLimits.videoMaxBytes).slice(0, Math.max(0, videoReferenceLimit - videoReferences.length));
            if (blobs.some((blob) => blob.size > referenceLimits.videoMaxBytes)) message.warning(`已忽略超过 ${referenceLimits.videoMaxBytes / 1024 / 1024}MB 的参考视频`);
            const nextVideoReferences = await Promise.all(
                usable.map(async (blob, index) => {
                    const video = await uploadMediaFile(blob, "video-reference");
                    return { id: nanoid(), name: `clipboard-video-${index + 1}.mp4`, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
                }),
            );
            setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, videoReferenceLimit));
            message.success(`已读取 ${nextVideoReferences.length} 个参考视频`);
        } catch {
            message.error("剪切板里没有可读取的视频");
        }
    };

    const addAudioReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("audio/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的音频");
                return;
            }
            const usable = blobs.filter((blob) => blob.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, referenceLimits.audios - audioReferences.length);
            if (blobs.some((blob) => blob.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
            const nextAudioReferences = filterAudioReferencesByDuration(
                audioReferences,
                await Promise.all(
                    usable.map(async (blob, index) => {
                        const audio = await uploadMediaFile(blob, "audio-reference");
                        return { id: nanoid(), name: `clipboard-audio-${index + 1}.mp3`, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, bytes: audio.bytes, durationMs: audio.durationMs };
                    }),
                ),
                referenceLimits,
                message.warning,
            );
            setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, referenceLimits.audios));
            message.success(`已读取 ${nextAudioReferences.length} 个参考音频`);
        } catch {
            message.error("剪切板里没有可读取的音频");
        }
    };

    const removeReference = async (id: string) => {
        const reference = references.find((item) => item.id === id);
        setReferences((value) => value.filter((ref) => ref.id !== id));
        if (!reference?.storageKey || referenceUsedByGeneration(reference, logs, results)) return;
        try {
            await deleteStoredImages([reference.storageKey]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图文件删除失败");
        }
    };

    const removeFrameReference = async (slot: "first" | "last") => {
        const reference = slot === "first" ? firstFrame : lastFrame;
        slot === "first" ? setFirstFrame(null) : setLastFrame(null);
        if (!reference?.storageKey || referenceUsedByGeneration(reference, logs, results)) return;
        try {
            await deleteStoredImages([reference.storageKey]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "首尾帧文件删除失败");
        }
    };

    const removeVideoReference = async (id: string) => {
        const reference = videoReferences.find((item) => item.id === id);
        setVideoReferences((value) => value.filter((ref) => ref.id !== id));
        if (!reference?.storageKey || mediaReferenceUsedByGeneration(reference.storageKey, logs, results)) return;
        try {
            await deleteStoredMedia([reference.storageKey]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考视频文件删除失败");
        }
    };

    const removeAudioReference = async (id: string) => {
        const reference = audioReferences.find((item) => item.id === id);
        setAudioReferences((value) => value.filter((ref) => ref.id !== id));
        if (!reference?.storageKey || mediaReferenceUsedByGeneration(reference.storageKey, logs, results)) return;
        try {
            await deleteStoredMedia([reference.storageKey]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考音频文件删除失败");
        }
    };

    const generate = async () => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPrompt("");
        await submitGenerationSnapshot(snapshot);
    };

    const buildRequestSnapshot = ({ promptText = prompt, referenceItems = references, firstFrameItem = firstFrame, lastFrameItem = lastFrame, videoReferenceItems = videoReferences, audioReferenceItems = audioReferences, taskCountValue = taskCount, configValue = videoConfig, modelValue = model }: { promptText?: string; referenceItems?: ReferenceImage[]; firstFrameItem?: ReferenceImage | null; lastFrameItem?: ReferenceImage | null; videoReferenceItems?: ReferenceVideo[]; audioReferenceItems?: ReferenceAudio[]; taskCountValue?: number; configValue?: AiConfig; modelValue?: string } = {}) => {
        const text = promptText.trim();
        if (!text && !runningHubPromptOptional(configValue, modelValue)) {
            message.error("请输入视频提示词");
            return null;
        }
        if (!isAiConfigReady(configValue, modelValue)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        if (!isMiniMaxH3Config(configValue, modelValue) && !isAgnesVideoV25Model(modelValue) && !isRunningHubConfig(configValue, modelValue)) {
            const videoReferenceError = seedanceVideoReferenceError(videoReferenceItems, seedanceReferenceLimits(configValue, modelValue));
            if (videoReferenceError) {
                message.error(`${videoReferenceError}。${seedanceVideoReferenceHint}`);
                return null;
            }
        }
        const normalizedConfig = buildVideoConfig(configValue, modelValue, videoReferenceMode({ firstFrame: firstFrameItem, lastFrame: lastFrameItem, references: referenceItems, videoReferences: videoReferenceItems, audioReferences: audioReferenceItems }));
        const input = { references: [...referenceItems], firstFrame: firstFrameItem, lastFrame: lastFrameItem, videoReferences: [...videoReferenceItems], audioReferences: [...audioReferenceItems] };
        const inputError = isMiniMaxH3Config(normalizedConfig, modelValue) ? miniMaxVideoInputError(modelValue, text, input) : isRunningHubConfig(normalizedConfig, modelValue) ? runningHubVideoInputError(modelValue, input) : "";
        if (inputError) { message.error(inputError); return null; }
        return { text, model: modelValue, config: normalizedConfig, ...input, taskCount: normalizeVideoCount(taskCountValue) };
    };

    const submitGenerationSnapshot = async (snapshot: { text: string; model: string; config: AiConfig; references: ReferenceImage[]; firstFrame?: ReferenceImage | null; lastFrame?: ReferenceImage | null; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[]; baseVideo?: ReferenceVideo | null; taskCount: number }) => {
        setRunning(true);
        setPreviewLog(null);
        setNow(Date.now());
        const pendingLogs = Array.from({ length: snapshot.taskCount }, () => {
            const clientTaskId = `client_video_task_${nanoid()}`;
            const task: VideoResponse = { id: clientTaskId, task_id: clientTaskId, model: snapshot.model, status: "queued", progress: 0, created_at: Date.now(), size: snapshot.config.size, seconds: snapshot.config.videoSeconds };
            return buildLog({ prompt: snapshot.text, model: snapshot.model, config: snapshot.config, references: snapshot.references, firstFrame: snapshot.firstFrame, lastFrame: snapshot.lastFrame, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, baseVideo: snapshot.baseVideo, durationMs: 0, status: "生成中", task, taskCount: snapshot.taskCount, lastPolledAt: Date.now() });
        });
        await Promise.all(pendingLogs.map((log) => logStore.setItem(log.id, serializeLog(log))));
        setLogs((value) => sortVideoLogs([...pendingLogs, ...value]));
        setResults((value) => sortVideoResults([...pendingLogs.map((log) => createResultFromLog(log, "pending")), ...value]));
        try {
            const settled = await Promise.allSettled(pendingLogs.map((log) => runVideoTask(log, snapshot)));
            const nextLogs = settled
                .map((item) => (item.status === "fulfilled" ? item.value : null))
                .filter((item): item is NonNullable<typeof item> => Boolean(item));
            const storedLogs = await readStoredLogs();
            setLogs(storedLogs);
            const createdCount = nextLogs.filter((item) => item.status === "生成中").length;
            const failedCount = nextLogs.filter((item) => item.status === "失败").length;
            createdCount ? message.success(`已创建 ${createdCount} 个视频任务`) : message.error("视频任务创建失败");
            if (failedCount) message.warning(`${failedCount} 个视频任务创建失败`);
        } finally {
            setRunning(false);
        }
    };

    const runVideoTask = async (pendingLog: GenerationLog, snapshot: { text: string; model: string; config: AiConfig; references: ReferenceImage[]; firstFrame?: ReferenceImage | null; lastFrame?: ReferenceImage | null; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[]; baseVideo?: ReferenceVideo | null; taskCount: number }) => {
        try {
            const created = await createVideoGenerationTask(snapshot.config, snapshot.text, { references: snapshot.references, firstFrame: snapshot.firstFrame, lastFrame: snapshot.lastFrame, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, baseVideo: snapshot.baseVideo }, (progress) => {
                setResults((value) => updateResultByLogId(value, pendingLog.id, { progress }));
            }, { clientTaskId: pendingLog.task?.id, source: "video-workbench" });
            const nextLog = { ...pendingLog, task: created, lastPolledAt: Date.now() };
            await saveGenerationLog(nextLog);
            setResults((value) => updateResultByLogId(value, pendingLog.id, { progress: created.progress, task: created, taskLogId: nextLog.id, lastPolledAt: nextLog.lastPolledAt }));
            return nextLog;
        } catch (error) {
            const durationMs = Date.now() - pendingLog.createdAt;
            const nextLog = { ...pendingLog, status: "失败" as const, durationMs, lastPolledAt: Date.now(), error: errorMessage(error), errorDetail: errorDetail(error) };
            await saveGenerationLog(nextLog);
            await persistVideoLog(nextLog);
            setResults((value) => updateResultByLogId(value, pendingLog.id, { status: "failed", taskLogId: nextLog.id, error: nextLog.error, errorDetail: nextLog.errorDetail, durationMs }));
            return nextLog;
        }
    };

    const retryResult = (result: GenerationResult) => {
        const retryChannelId = videoTaskChannelId(result.task);
        const snapshot = buildRequestSnapshot({ promptText: result.prompt, referenceItems: result.references, firstFrameItem: result.firstFrame, lastFrameItem: result.lastFrame, videoReferenceItems: result.videoReferences, audioReferenceItems: result.audioReferences, taskCountValue: 1, configValue: { ...videoConfig, ...result.config, ...(retryChannelId ? { videoChannelId: retryChannelId, activeChannelId: retryChannelId } : {}), model: result.model, videoModel: result.model }, modelValue: result.model });
        if (!snapshot) return;
        setResults((value) => value.filter((item) => item.id !== result.id));
        void submitGenerationSnapshot({ ...snapshot, baseVideo: result.baseVideo });
    };

    const previewGenerationResult = (result: GenerationResult) => {
        setPreviewLog(null);
        setResults((value) => value.filter((item) => item.id !== result.id));
        setPrompt(result.prompt);
        setReferences(result.references || []);
        setFirstFrame(result.firstFrame || null);
        setLastFrame(result.lastFrame || null);
        setVideoReferences(result.videoReferences || []);
        setAudioReferences(result.audioReferences || []);
        const nextModel = result.config.videoModel || result.model;
        const nextChannelId = resolveVideoChannelId(effectiveConfig, nextModel, videoTaskChannelId(result.task), result.config.videoChannelId, result.config.activeChannelId);
        if (nextModel) updateConfig("videoModel", nextModel);
        if (nextChannelId) {
            updateConfig("videoChannelId", nextChannelId);
            updateConfig("activeChannelId", nextChannelId);
        }
        if (result.config.size) updateConfig("videoSize", result.config.size);
        if (result.config.vquality) updateConfig("vquality", result.config.vquality);
        if (result.config.videoSeconds) updateConfig("videoSeconds", result.config.videoSeconds);
        if (result.config.videoGenerateAudio) updateConfig("videoGenerateAudio", result.config.videoGenerateAudio);
        if (result.config.videoWatermark) updateConfig("videoWatermark", result.config.videoWatermark);
    };

    const downloadVideo = async (video: GeneratedVideo) => {
        const hideLoading = message.loading("正在下载视频...", 0);
        try {
            saveAs(await downloadRemoteMedia(video.url), "video.mp4");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频下载失败");
        } finally {
            hideLoading();
        }
    };

    const syncVideo = async (video: GeneratedVideo, index = 0) => {
        if (isCloudVideo(video)) return video;
        setSyncingVideoIds((ids) => Array.from(new Set([...ids, video.id])));
        const hideLoading = message.loading("正在同步视频到云端存储...", 0);
        try {
            const uploaded = await uploadRemoteMediaToServer(video.url, `video-${index + 1}.mp4`);
            message.success("视频已同步到云端存储");
            return { ...video, url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || video.width, height: uploaded.height || video.height, bytes: uploaded.bytes || video.bytes, mimeType: uploaded.mimeType || video.mimeType };
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频同步失败");
            return null;
        } finally {
            hideLoading();
            setSyncingVideoIds((ids) => ids.filter((id) => id !== video.id));
        }
    };

    const syncResultVideo = async (resultId: string, video: GeneratedVideo, index: number) => {
        const synced = await syncVideo(video, index);
        if (!synced) return;
        setResults((value) => updateResult(value, resultId, { video: synced }));
    };

    const syncLogVideo = async (log: GenerationLog, video: GeneratedVideo, index: number) => {
        const synced = await syncVideo(video, index);
        if (!synced) return;
        const nextLog = { ...log, video: synced };
        await logStore.setItem(log.id, serializeLog(nextLog));
        const nextLogs = logs.map((item) => (item.id === log.id ? nextLog : item));
        setLogs(nextLogs);
        await persistVideoLog(nextLog);
        if (previewLog?.id === log.id) setPreviewLog(nextLog);
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: "生成视频",
            coverUrl: "",
            tags: [],
            source: "视频创作台",
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        const insertImage = async () => {
            if (payload.kind !== "image") {
                message.warning("请选择图片素材");
                return;
            }
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: payload.mimeType || "image/*", dataUrl: payload.dataUrl, storageKey: payload.storageKey, bytes: payload.bytes, width: payload.width, height: payload.height }].slice(0, referenceImageLimit));
        };
        const insertFrame = (slot: "first" | "last") => {
            if (payload.kind !== "image") {
                message.warning("请选择图片素材");
                return;
            }
            const next = { id: nanoid(), name: payload.title, type: payload.mimeType || "image/*", dataUrl: payload.dataUrl, storageKey: payload.storageKey, bytes: payload.bytes, width: payload.width, height: payload.height };
            slot === "first" ? setFirstFrame(next) : setLastFrame(next);
        };
        const insertVideo = () => {
            if (payload.kind !== "video") {
                message.warning("请选择视频素材");
                return;
            }
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: payload.mimeType || "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height, bytes: payload.bytes, durationMs: payload.durationMs }].slice(0, videoReferenceLimit));
        };
        const insertAudio = () => {
            if (payload.kind !== "audio") {
                message.warning("请选择音频素材");
                return;
            }
            const next = filterAudioReferencesByDuration(audioReferences, [{ id: nanoid(), name: payload.title, type: payload.mimeType || "audio/mpeg", url: payload.url, storageKey: payload.storageKey, bytes: payload.bytes, durationMs: payload.durationMs }], referenceLimits, message.warning);
            setAudioReferences((value) => [...value, ...next].slice(0, referenceLimits.audios));
        };

        if (assetPickerTarget === "firstFrame") {
            insertFrame("first");
        } else if (assetPickerTarget === "lastFrame") {
            insertFrame("last");
        } else if (assetPickerTarget === "image") {
            await insertImage();
        } else if (assetPickerTarget === "video") {
            insertVideo();
        } else if (assetPickerTarget === "audio") {
            insertAudio();
        } else if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            await insertImage();
        } else if (payload.kind === "video") {
            insertVideo();
        } else if (payload.kind === "audio") {
            insertAudio();
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setFirstFrame(null);
        setLastFrame(null);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const selectedLogs = logs.filter((log) => selectedLogIds.includes(log.id));
        const deleteKeys = new Set(selectedLogs.flatMap(videoLogDeleteKeys));
        const deletedLogs = logs.filter((log) => selectedLogIds.includes(log.id) || videoLogDeleteKeys(log).some((key) => deleteKeys.has(key)));
        const nextLogs = logs.filter((log) => !deletedLogs.some((deleted) => deleted.id === log.id));
        const keys = disposableLogStorageKeys(deletedLogs, nextLogs, [firstFrame, lastFrame, ...references].filter((item): item is ReferenceImage => Boolean(item)), [...videoReferences, ...audioReferences], results);
        setLogs(nextLogs);
        logsRef.current = nextLogs;
        setResults((value) => value.filter((item) => !selectedLogIds.includes(item.id) && !selectedLogIds.includes(item.taskLogId || "") && !videoResultIdentityKeys(item).some((key) => deleteKeys.has(key))));
        void Promise.all([deleteBackendVideoTasks(deletedLogs), deleteAccountVideoLogs(deletedLogs), deleteStoredMedia(keys.media), deleteStoredImages(keys.images), ...deletedLogs.map((log) => logStore.removeItem(log.id))]).catch(() => undefined);
        if (previewLog && deletedLogs.some((log) => log.id === previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const deleteBackendVideoTasks = async (items: GenerationLog[]) => {
        const config = effectiveConfigRef.current;
        if (!token || !usesAccountProxy(config)) return;
        await Promise.all(items.filter((item) => item.task && !isLocalClientVideoTask(item.task)).map((item) => deleteVideoGenerationTask(config, item.task).catch(() => undefined)));
    };

    const deleteAccountVideoLogs = async (items: GenerationLog[]) => {
        if (!token) return;
        const ids = Array.from(new Set(items.flatMap(videoLogDeleteKeys)));
        if (!ids.length) return;
        await deleteVideoGenerationLogs(token, ids).catch(() => undefined);
    };

    const refreshLogs = async () => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        return nextLogs;
    };

    const syncBackendVideoTasks = async (baseLogs?: GenerationLog[]) => {
        const config = effectiveConfigRef.current;
        if (!token || !usesAccountProxy(config)) return baseLogs || logsRef.current;
        try {
            const tasks = await listVideoGenerationTasks(config);
            const recoverableTasks = tasks.filter(isRecoverableBackendVideoTask);
            if (!recoverableTasks.length) return baseLogs || logsRef.current;
            const currentLogs = baseLogs || (await readStoredLogs());
            const mergedLogs = mergeBackendVideoTasks(currentLogs, recoverableTasks, config);
            const taskKeys = new Set(recoverableTasks.flatMap(videoTaskIdentityKeys));
            const recoveredLogs = mergedLogs.filter((log) => videoLogIdentityKeys(log).some((key) => taskKeys.has(key)));
            await persistStoredVideoLogs(recoveredLogs);
            setLogs(mergedLogs);
            setResults((value) => mergePendingLogResults(value, mergedLogs.filter((log) => log.status === "生成中" && log.task && !log.video)));
            return mergedLogs;
        } catch {
            return baseLogs || logsRef.current;
        }
    };

    const loadAccountVideoHistory = async (currentToken: string) => {
        try {
            const localLogs = await readStoredLogs();
            const remoteLogs = await fetchVideoGenerationLogs<GenerationLog>(currentToken);
            const mergedLogs = await mergeVideoLogs(remoteLogs, localLogs);
            await replaceStoredVideoHistory(mergedLogs);
            setLogs(mergedLogs);
            return mergedLogs;
        } catch {
            // Keep local video history available when account sync fails.
            return undefined;
        }
    };

    const persistVideoLog = async (log: GenerationLog) => {
        if (!token || !shouldSyncVideoLog(log)) return;
        await saveVideoGenerationLogs(token, [serializeLog(log)]).catch(() => undefined);
    };

    const saveGenerationLog = async (log: GenerationLog) => {
        await logStore.setItem(log.id, serializeLog(log));
        setLogs((value) => sortVideoLogs([log, ...value.filter((item) => item.id !== log.id)]));
    };

    const finalizeGenerationLog = async (log: GenerationLog) => {
        await saveGenerationLog(log);
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        await persistVideoLog(log);
    };

    const pollPendingLogOnce = async (log: GenerationLog, resumeConfig: AiConfig) => {
        pollingLogIdsRef.current.add(log.id);
        const startedAt = log.createdAt || Date.now();
        try {
            const task = await pollVideoGenerationTaskStatus(resumeConfig, log.task!);
            const durationMs = Date.now() - startedAt;
            const baseLog = { ...log, task, durationMs, lastPolledAt: Date.now() };
            if (isFailedTask(task.status)) {
                const nextLog = { ...baseLog, status: "失败" as const, error: task.error?.message || "视频生成失败", errorDetail: errorDetail(new VideoRequestError(task.error?.message || "视频生成失败", task)) };
                await finalizeGenerationLog(nextLog);
                setResults((value) => updateResultByLogId(value, log.id, { status: "failed", task, error: nextLog.error, errorDetail: nextLog.errorDetail, durationMs: nextLog.durationMs, lastPolledAt: nextLog.lastPolledAt }));
                return;
            }
            if (isCompletedVideoTask(task)) {
                if (!task.video_url && !task.url) {
                    const nextLog = { ...baseLog, status: "失败" as const, error: "视频生成完成但没有返回视频地址", errorDetail: errorDetail(new VideoRequestError("视频生成完成但没有返回视频地址", task)) };
                    await finalizeGenerationLog(nextLog);
                    setResults((value) => updateResultByLogId(value, log.id, { status: "failed", task, error: nextLog.error, errorDetail: nextLog.errorDetail, durationMs: nextLog.durationMs, lastPolledAt: nextLog.lastPolledAt }));
                    return;
                }
                const video = videoFromTaskResponse(task, durationMs);
                const nextLog = { ...baseLog, status: "成功" as const, video, error: undefined, errorDetail: undefined };
                await finalizeGenerationLog(nextLog);
                setResults((value) => value.filter((item) => item.taskLogId !== log.id && item.id !== log.id));
                return;
            }
            await saveGenerationLog(baseLog);
            setResults((value) => updateResultByLogId(value, log.id, { task, progress: task.progress, durationMs, lastPolledAt: baseLog.lastPolledAt }));
        } catch (error) {
            const nextLog = { ...log, durationMs: Date.now() - startedAt, lastPolledAt: Date.now(), error: errorMessage(error), errorDetail: errorDetail(error) };
            if (isTransientVideoPollError(error)) {
                await saveGenerationLog({ ...nextLog, status: "生成中" });
                setResults((value) => updateResultByLogId(value, log.id, { error: nextLog.error, errorDetail: nextLog.errorDetail, durationMs: nextLog.durationMs, lastPolledAt: nextLog.lastPolledAt }));
                return;
            }
            await finalizeGenerationLog({ ...nextLog, status: "失败" });
            setResults((value) => updateResultByLogId(value, log.id, { status: "failed", error: nextLog.error, errorDetail: nextLog.errorDetail, durationMs: nextLog.durationMs, lastPolledAt: nextLog.lastPolledAt }));
        } finally {
            pollingLogIdsRef.current.delete(log.id);
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        setPreviewLog(log);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setFirstFrame(log.firstFrame || null);
        setLastFrame(log.lastFrame || null);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        const nextModel = log.config.videoModel || log.model;
        const nextChannelId = resolveVideoChannelId(effectiveConfig, nextModel, videoTaskChannelId(log.task), log.config.videoChannelId, log.config.activeChannelId);
        if (nextModel) updateConfig("videoModel", nextModel);
        if (nextChannelId) {
            updateConfig("videoChannelId", nextChannelId);
            updateConfig("activeChannelId", nextChannelId);
        }
        if (log.config.size) updateConfig("videoSize", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
    };

    const buildLogSnapshot = (log: GenerationLog, configPatch: Partial<AiConfig> = {}) => {
        const retryChannelId = videoTaskChannelId(log.task);
        return buildRequestSnapshot({ promptText: log.prompt, referenceItems: log.references || [], firstFrameItem: log.firstFrame || null, lastFrameItem: log.lastFrame || null, videoReferenceItems: log.videoReferences || [], audioReferenceItems: log.audioReferences || [], taskCountValue: 1, configValue: { ...videoConfig, ...log.config, ...(retryChannelId ? { videoChannelId: retryChannelId, activeChannelId: retryChannelId } : {}), model: log.model, videoModel: log.model, ...configPatch }, modelValue: log.model });
    };

    const retryGenerationLog = (log: GenerationLog) => {
        const snapshot = buildLogSnapshot(log);
        if (snapshot) void submitGenerationSnapshot({ ...snapshot, baseVideo: log.baseVideo });
    };

    const regenerateLog2K = (log: GenerationLog) => {
        const video = log.video;
        const snapshot = video ? buildLogSnapshot(log, { vquality: "2K" }) : null;
        if (!video || !snapshot) return;
        if (!isMiniMaxH3Config(snapshot.config, snapshot.model)) {
            message.error("仅 MiniMax 官方渠道的 MiniMax-H3 支持 2K 重生成");
            return;
        }
        void submitGenerationSnapshot({ ...snapshot, baseVideo: { id: video.id, name: "base-video.mp4", type: video.mimeType || "video/mp4", url: video.url, storageKey: video.storageKey } });
    };

    const optimizePrompt = async () => {
        const snapshot = buildRequestSnapshot({ taskCountValue: 1 });
        if (!snapshot) return;
        setOptimizingPrompt(true);
        try {
            const optimized = await optimizeMiniMaxPrompt(snapshot.config, snapshot.text, { references: snapshot.references, firstFrame: snapshot.firstFrame, lastFrame: snapshot.lastFrame, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences });
            modal.confirm({ title: "AI 优化提示词", icon: null, width: 720, okText: "替换提示词", cancelText: "保留原提示词", content: <div className="thin-scrollbar max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm">{optimized}</div>, onOk: () => setPrompt(optimized) });
        } catch (error) {
            message.error(errorMessage(error));
        } finally {
            setOptimizingPrompt(false);
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className={`${workbenchLayout === "side" ? "grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)]" : "relative flex flex-col"} min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:overflow-hidden`}>
                {workbenchLayout === "side" ? (
                    <>
                        <WorkbenchPanel
                            layout="side"
                            currentLayout={workbenchLayout}
                            prompt={prompt}
                            references={references}
                            firstFrame={firstFrame}
                            lastFrame={lastFrame}
                            videoReferences={videoReferences}
                            audioReferences={audioReferences}
                            config={videoConfig}
                            model={model}
                            canGenerate={canGenerate}
                            running={running}
                            pendingCount={pendingCount}
                            taskCount={taskCount}
                            onTaskCountChange={setTaskCount}
                            updateConfig={updateVideoConfig}
                            openConfigDialog={openConfigDialog}
                            onLayoutChange={setWorkbenchLayout}
                            onPromptChange={setPrompt}
                            onOpenPromptLibrary={() => setPromptDialogOpen(true)}
                            onOpenAssetPicker={openAssetPicker}
                            onPastePrompt={() => void pastePromptFromClipboard()}
                            onClearPrompt={() => setPrompt("")}
                            onPasteReferences={() => void addReferencesFromClipboard()}
                            onPasteFrame={(slot) => void setFrameFromClipboard(slot)}
                            onPasteVideoReferences={() => void addVideoReferencesFromClipboard()}
                            onPasteAudioReferences={() => void addAudioReferencesFromClipboard()}
                            onUploadReferences={() => fileInputRef.current?.click()}
                            onUploadFrame={(slot) => (slot === "first" ? firstFrameInputRef.current?.click() : lastFrameInputRef.current?.click())}
                            onRemoveFrame={(slot) => void removeFrameReference(slot)}
                            onRemoveReference={(id) => void removeReference(id)}
                            onMoveReference={(index, offset) => setReferences((value) => moveListItem(value, index, offset))}
                            onRemoveVideoReference={(id) => void removeVideoReference(id)}
                            onMoveVideoReference={(index, offset) => setVideoReferences((value) => moveListItem(value, index, offset))}
                            onRemoveAudioReference={(id) => void removeAudioReference(id)}
                            onMoveAudioReference={(index, offset) => setAudioReferences((value) => moveListItem(value, index, offset))}
                            optimizingPrompt={optimizingPrompt}
                            onOptimizePrompt={() => void optimizePrompt()}
                            onGenerate={() => void generate()}
                        />
                        <ResultsPanel
                            results={results}
                            logs={logs}
                            pendingCount={pendingCount}
                            now={now}
                            selectedLogIds={selectedLogIds}
                            activeLogId={previewLog?.id}
                            onSelectedLogIdsChange={setSelectedLogIds}
                            onCreateSession={createSession}
                            onDeleteSelected={() => setDeleteConfirmOpen(true)}
                            onDeleteLog={(log) => {
                                setSelectedLogIds([log.id]);
                                setDeleteConfirmOpen(true);
                            }}
                            onPreviewLog={previewGenerationLog}
                            onRetryLog={retryGenerationLog}
                            onRegenerateLog2K={regenerateLog2K}
                            onPreviewResult={previewGenerationResult}
                            onRetryResult={retryResult}
                            onCopyPrompt={(value) => void copyPrompt(value, (content) => message.success(content))}
                            onDownload={downloadVideo}
                            onSyncResult={syncResultVideo}
                            onSyncLog={syncLogVideo}
                            onSaveAsset={saveResultToAssets}
                            syncingVideoIds={syncingVideoIds}
                        />
                    </>
                ) : (
                    <>
                        <ResultsPanel
                            className="min-h-[360px] flex-1 pb-40 lg:pb-44"
                            results={results}
                            logs={logs}
                            pendingCount={pendingCount}
                            now={now}
                            selectedLogIds={selectedLogIds}
                            activeLogId={previewLog?.id}
                            onSelectedLogIdsChange={setSelectedLogIds}
                            onCreateSession={createSession}
                            onDeleteSelected={() => setDeleteConfirmOpen(true)}
                            onDeleteLog={(log) => {
                                setSelectedLogIds([log.id]);
                                setDeleteConfirmOpen(true);
                            }}
                            onPreviewLog={previewGenerationLog}
                            onRetryLog={retryGenerationLog}
                            onRegenerateLog2K={regenerateLog2K}
                            onPreviewResult={previewGenerationResult}
                            onRetryResult={retryResult}
                            onCopyPrompt={(value) => void copyPrompt(value, (content) => message.success(content))}
                            onDownload={downloadVideo}
                            onSyncResult={syncResultVideo}
                            onSyncLog={syncLogVideo}
                            onSaveAsset={saveResultToAssets}
                            syncingVideoIds={syncingVideoIds}
                        />
                        <WorkbenchPanel
                            layout="bottom"
                            currentLayout={workbenchLayout}
                            prompt={prompt}
                            references={references}
                            firstFrame={firstFrame}
                            lastFrame={lastFrame}
                            videoReferences={videoReferences}
                            audioReferences={audioReferences}
                            config={videoConfig}
                            model={model}
                            canGenerate={canGenerate}
                            running={running}
                            pendingCount={pendingCount}
                            taskCount={taskCount}
                            onTaskCountChange={setTaskCount}
                            updateConfig={updateVideoConfig}
                            openConfigDialog={openConfigDialog}
                            onLayoutChange={setWorkbenchLayout}
                            onPromptChange={setPrompt}
                            onOpenPromptLibrary={() => setPromptDialogOpen(true)}
                            onOpenAssetPicker={openAssetPicker}
                            onPastePrompt={() => void pastePromptFromClipboard()}
                            onClearPrompt={() => setPrompt("")}
                            onPasteReferences={() => void addReferencesFromClipboard()}
                            onPasteFrame={(slot) => void setFrameFromClipboard(slot)}
                            onPasteVideoReferences={() => void addVideoReferencesFromClipboard()}
                            onPasteAudioReferences={() => void addAudioReferencesFromClipboard()}
                            onUploadReferences={() => fileInputRef.current?.click()}
                            onUploadFrame={(slot) => (slot === "first" ? firstFrameInputRef.current?.click() : lastFrameInputRef.current?.click())}
                            onRemoveFrame={(slot) => void removeFrameReference(slot)}
                            onRemoveReference={(id) => void removeReference(id)}
                            onMoveReference={(index, offset) => setReferences((value) => moveListItem(value, index, offset))}
                            onRemoveVideoReference={(id) => void removeVideoReference(id)}
                            onMoveVideoReference={(index, offset) => setVideoReferences((value) => moveListItem(value, index, offset))}
                            onRemoveAudioReference={(id) => void removeAudioReference(id)}
                            onMoveAudioReference={(index, offset) => setAudioReferences((value) => moveListItem(value, index, offset))}
                            optimizingPrompt={optimizingPrompt}
                            onOptimizePrompt={() => void optimizePrompt()}
                            onGenerate={() => void generate()}
                            bottomSettingsCollapsed={bottomSettingsCollapsed}
                            setBottomSettingsCollapsed={setBottomSettingsCollapsed}
                        />
                    </>
                )}
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={firstFrameInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    void uploadFrameReference("first", event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={lastFrameInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    void uploadFrameReference("last", event.target.files);
                    event.target.value = "";
                }}
            />
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function WorkbenchPanel({
    layout,
    currentLayout,
    prompt,
    references,
    firstFrame,
    lastFrame,
    videoReferences,
    audioReferences,
    config,
    model,
    canGenerate,
    running,
    pendingCount,
    taskCount,
    onTaskCountChange,
    updateConfig,
    openConfigDialog,
    onLayoutChange,
    onPromptChange,
    onOpenPromptLibrary,
    onOpenAssetPicker,
    onPastePrompt,
    onClearPrompt,
    onPasteReferences,
    onPasteFrame,
    onPasteVideoReferences,
    onPasteAudioReferences,
    onUploadReferences,
    onUploadFrame,
    onRemoveFrame,
    onRemoveReference,
    onMoveReference,
    onRemoveVideoReference,
    onMoveVideoReference,
    onRemoveAudioReference,
    onMoveAudioReference,
    optimizingPrompt,
    onOptimizePrompt,
    onGenerate,
    bottomSettingsCollapsed = true,
    setBottomSettingsCollapsed,
}: {
    layout: WorkbenchLayout;
    currentLayout: WorkbenchLayout;
    prompt: string;

    references: ReferenceImage[];
    firstFrame: ReferenceImage | null;
    lastFrame: ReferenceImage | null;
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    config: AiConfig;
    model: string;
    canGenerate: boolean;
    running: boolean;
    pendingCount: number;
    taskCount: number;
    onTaskCountChange: (value: number) => void;
    updateConfig: UpdateAiConfig;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    onLayoutChange: (layout: WorkbenchLayout) => void;
    onPromptChange: (value: string) => void;
    onOpenPromptLibrary: () => void;
    onOpenAssetPicker: (target?: AssetPickerTarget) => void;
    onPastePrompt: () => void;
    onClearPrompt: () => void;
    onPasteReferences: () => void;
    onPasteFrame: (slot: "first" | "last") => void;
    onPasteVideoReferences: () => void;
    onPasteAudioReferences: () => void;
    onUploadReferences: () => void;
    onUploadFrame: (slot: "first" | "last") => void;
    onRemoveFrame: (slot: "first" | "last") => void;
    onRemoveReference: (id: string) => void;
    onMoveReference: (index: number, offset: number) => void;
    onRemoveVideoReference: (id: string) => void;
    onMoveVideoReference: (index: number, offset: number) => void;
    onRemoveAudioReference: (id: string) => void;
    onMoveAudioReference: (index: number, offset: number) => void;
    optimizingPrompt: boolean;
    onOptimizePrompt: () => void;
    onGenerate: () => void;
    bottomSettingsCollapsed?: boolean;
    setBottomSettingsCollapsed?: (value: boolean) => void;
}) {
    const frameReferencesEnabled = supportsVideoFrameReferences(model, channelProtocolForConfig({ ...config, model }));
    const inputMode = videoReferenceMode({ firstFrame, lastFrame, references, videoReferences, audioReferences });
    const durationRule = videoDurationRule(config, inputMode);
    const parameterOptions = videoParameterOptions(config, inputMode);
    const referenceLimits = seedanceReferenceLimits(config, model);
    const audioGenerationEnabled = !isMiniMaxH3Config(config, model) && supportsVideoAudioGeneration(model, channelProtocolForConfig({ ...config, model, videoModel: model }));
    const generateAudio = boolConfig(config.videoGenerateAudio, false);
    const miniMax = isMiniMaxH3Config(config, model) ? miniMaxVideoCapabilities(model) : null;
    const canOptimizePrompt = (Boolean(miniMax) && isMiniMaxH3BaseModel(model)) || (model === RUNNINGHUB_PROMPT_OPTIMIZE_MODEL && isRunningHubConfig(config, model));
    const bottomSettingsGridClass = audioGenerationEnabled ? "lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr_0.8fr_0.7fr_auto_auto]" : "lg:grid-cols-[1.3fr_0.8fr_0.8fr_0.7fr_0.7fr_auto_auto]";

    if (layout === "bottom") {
        return (
            <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-5 sm:bottom-7 sm:px-10 lg:px-16">
                <div className="pointer-events-auto w-full max-w-5xl rounded-[24px] bg-white/65 p-4 shadow-[0_32px_100px_rgba(15,23,42,.22),0_10px_34px_rgba(15,23,42,.10)] ring-1 ring-white/50 backdrop-blur-2xl dark:bg-stone-950/60 dark:ring-white/10 dark:shadow-[0_34px_110px_rgba(0,0,0,.58)]">
                    <div className="flex flex-col gap-3">
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                            <Input.TextArea
                                value={prompt}
                                onChange={(event) => onPromptChange(event.target.value)}
                                placeholder="描述镜头运动、主体动作、场景氛围和画面风格"
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                className="rounded-2xl"
                                onPressEnter={(event) => {
                                    if (!event.shiftKey && canGenerate) onGenerate();
                                }}
                            />
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                <Button title="清空输入" icon={<Trash2 className="size-4" />} onClick={onClearPrompt} />
                                <Button title="提示词库" icon={<BookOpen className="size-4" />} onClick={onOpenPromptLibrary} />
                                {canOptimizePrompt ? <Button title="AI 优化提示词" icon={<WandSparkles className="size-4" />} loading={optimizingPrompt} disabled={!prompt.trim()} onClick={onOptimizePrompt} /> : null}
                                <Button title="我的素材" icon={<FolderPlus className="size-4" />} onClick={() => onOpenAssetPicker()} />
                                <Button title="参数配置" className={`lg:hidden ${!bottomSettingsCollapsed ? "!border-sky-500/30 !bg-sky-500/10 !text-sky-500" : ""}`} icon={<SlidersHorizontal className="size-4" />} onClick={() => setBottomSettingsCollapsed?.(!bottomSettingsCollapsed)} />
                                <Button title="切换到侧边工作台" icon={<PanelLeft className="size-4" />} onClick={() => onLayoutChange("side")} />
                                <Button type="primary" className="h-9 rounded-xl px-4 font-medium lg:!hidden" icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={onGenerate}>
                                    {pendingCount ? `${pendingCount} 生成中` : "开始创作"}
                                </Button>
                            </div>
                        </div>
                        <div className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${bottomSettingsGridClass} ${bottomSettingsCollapsed ? "hidden lg:grid" : "grid"}`}>
                            <label className="grid gap-1 text-xs text-stone-500 dark:text-stone-400">
                                模型
                                <ModelPicker config={config} value={model} channelId={config.videoChannelId} onChange={(value, channelId) => { updateConfig("videoModel", value); if (channelId) updateConfig("videoChannelId", channelId); }} capability="video" className="canvas-compact-control !h-11 !rounded-xl" onMissingConfig={() => openConfigDialog(false)} fullWidth />
                            </label>
                            {miniMax ? <>
                                <QuickSelect label="清晰度" value={normalizeMiniMaxH3Resolution(config.vquality, model)} options={miniMax.resolutions.map((value) => ({ value, label: value }))} onChange={(value) => updateConfig("vquality", value)} />
                                <QuickSelect label="比例" value={normalizeMiniMaxH3Ratio(config.size, firstFrame || lastFrame ? "frames" : references.length || videoReferences.length || audioReferences.length ? "reference" : "text")} options={firstFrame || lastFrame ? [{ value: "adaptive", label: "跟随首帧" }] : miniMaxRatioOptions.filter((item) => references.length || videoReferences.length || audioReferences.length || item.value !== "adaptive")} onChange={(value) => updateConfig("size", value)} />
                                <QuickNumber label="秒数" value={String(normalizeMiniMaxH3Duration(config.videoSeconds, model))} min={miniMax.minSeconds} max={15} onChange={(value) => updateConfig("videoSeconds", value)} />
                            </> : <>
                                {parameterOptions.resolutions?.length === 0 ? null : <QuickSelect label="清晰度" value={normalizeVideoResolutionValue(config.vquality)} options={parameterOptions.resolutions?.map((value) => ({ value: normalizeVideoResolutionValue(value), label: videoResolutionLabel(value) })) || videoResolutionOptions} onChange={(value) => { updateConfig("vquality", value); if (!parameterOptions.ratios) updateConfig("size", videoSizeForResolution(value, config.size)); }} />}
                                <QuickSelect label={parameterOptions.ratios ? "比例" : "尺寸"} value={parameterOptions.ratios ? config.size : videoSizeForResolution(config.vquality, config.size)} options={parameterOptions.ratios?.map((value) => ({ value, label: value === "adaptive" ? "自适应" : value })) || videoSizeOptions(config.vquality)} onChange={(value) => updateConfig("size", value)} />
                                {durationRule.values ? <QuickSelect label="秒数" value={config.videoSeconds} options={durationRule.values.map((value) => ({ value: String(value), label: `${value}s` }))} onChange={(value) => updateConfig("videoSeconds", value)} /> : <QuickNumber label="秒数" value={config.videoSeconds} min={durationRule.auto ?? durationRule.min} max={durationRule.max} onChange={(value) => updateConfig("videoSeconds", value)} />}
                            </>}
                            {audioGenerationEnabled ? <QuickSwitch label="生成音频" checked={generateAudio} onChange={(checked) => updateConfig("videoGenerateAudio", String(checked))} /> : null}
                            <QuickNumber label="任务" value={String(taskCount)} min={1} max={6} onChange={(value) => onTaskCountChange(normalizeVideoCount(value))} />
                            <ReferenceQuickActions imageCount={references.length} videoCount={videoReferences.length} audioCount={audioReferences.length} onPasteReferences={onPasteReferences} onUploadReferences={onUploadReferences} />
                            <Button type="primary" className="hidden h-11 min-w-28 items-center justify-center gap-1.5 rounded-xl lg:flex" icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={onGenerate}>
                                {pendingCount ? `${pendingCount} 生成中` : "开始创作"}
                            </Button>
                        </div>
                        {firstFrame || lastFrame || references.length || videoReferences.length || audioReferences.length ? (
                            <div className="grid gap-2">
                                {firstFrame || lastFrame ? <FrameReferenceStrip firstFrame={firstFrame} lastFrame={lastFrame} compact onUploadFrame={onUploadFrame} onRemoveFrame={onRemoveFrame} /> : null}
                                {references.length ? <ReferenceImageStrip references={references} compact onRemoveReference={onRemoveReference} onMoveReference={onMoveReference} /> : null}
                                {videoReferences.length ? <ReferenceVideoStrip references={videoReferences} compact onRemoveReference={onRemoveVideoReference} onMoveReference={onMoveVideoReference} /> : null}
                                {audioReferences.length ? <ReferenceAudioStrip references={audioReferences} compact onRemoveReference={onRemoveAudioReference} onMoveReference={onMoveAudioReference} /> : null}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0">
            <div className="shrink-0 p-4 pb-3">
                <WorkbenchHeader currentLayout={currentLayout} onLayoutChange={onLayoutChange} />
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
                <WorkbenchSection title="提示词">
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={onPastePrompt}>读取剪贴板</Button>
                            <Button size="small" icon={<Trash2 className="size-3.5" />} onClick={onClearPrompt}>清空</Button>
                            <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={onOpenPromptLibrary}>提示词库</Button>
                            {canOptimizePrompt ? <Button size="small" icon={<WandSparkles className="size-3.5" />} loading={optimizingPrompt} disabled={!prompt.trim()} onClick={onOptimizePrompt}>AI 优化</Button> : null}
                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onOpenAssetPicker()}>我的素材</Button>
                        </div>
                        <Input.TextArea value={prompt} onChange={(event) => onPromptChange(event.target.value)} rows={6} placeholder="描述镜头运动、主体动作、场景氛围和画面风格" />
                    </div>
                </WorkbenchSection>
                {frameReferencesEnabled ? (
                    <WorkbenchSection title="首尾帧" count={[firstFrame, lastFrame].filter(Boolean).length}>
                        <FrameReferenceStrip firstFrame={firstFrame} lastFrame={lastFrame} onPasteFrame={onPasteFrame} onUploadFrame={onUploadFrame} onOpenAssetPicker={onOpenAssetPicker} onRemoveFrame={onRemoveFrame} />
                    </WorkbenchSection>
                ) : null}
                <WorkbenchSection title="参考图" count={references.length}>
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={onPasteReferences}>剪切板</Button>
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={onUploadReferences}>上传</Button>
                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onOpenAssetPicker("image")}>从素材库选择</Button>
                        </div>
                        <ReferenceImageStrip references={references} maxCount={referenceLimits.images} onRemoveReference={onRemoveReference} onMoveReference={onMoveReference} />
                    </div>
                </WorkbenchSection>
                <WorkbenchSection title="参考视频" count={videoReferences.length}>
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={onPasteVideoReferences}>剪贴板</Button>
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={onUploadReferences}>上传</Button>
                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onOpenAssetPicker("video")}>从素材库选择</Button>
                        </div>
                        <ReferenceVideoStrip references={videoReferences} maxCount={referenceLimits.videos} onRemoveReference={onRemoveVideoReference} onMoveReference={onMoveVideoReference} />
                    </div>
                </WorkbenchSection>
                <WorkbenchSection title="参考音频" count={audioReferences.length}>
                    <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={onPasteAudioReferences}>剪贴板</Button>
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={onUploadReferences}>上传</Button>
                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onOpenAssetPicker("audio")}>从素材库选择</Button>
                        </div>
                        <ReferenceAudioStrip references={audioReferences} maxCount={referenceLimits.audios} onRemoveReference={onRemoveAudioReference} onMoveReference={onMoveAudioReference} />
                    </div>
                </WorkbenchSection>
                <GenerationSettings config={config} model={model} referenceMode={firstFrame || lastFrame ? "frames" : references.length || videoReferences.length || audioReferences.length ? "reference" : "text"} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                <WorkbenchSection title="任务数量">
                    <TaskCountControl value={taskCount} onChange={onTaskCountChange} />
                </WorkbenchSection>
            </div>
            <div className="shrink-0 border-t border-stone-200 p-4 dark:border-stone-800">
                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={onGenerate}>
                    {pendingCount ? `生成中（${pendingCount}）` : "开始生成"}
                </Button>
            </div>
        </div>
    );
}

function WorkbenchHeader({ currentLayout, onLayoutChange }: { currentLayout: WorkbenchLayout; onLayoutChange: (layout: WorkbenchLayout) => void }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">视频创作台</h1>
            <div className="flex shrink-0 rounded-lg border border-stone-200 bg-stone-50 p-1 dark:border-stone-800 dark:bg-stone-900">
                <Button size="small" type={currentLayout === "side" ? "primary" : "text"} icon={<PanelLeft className="size-3.5" />} onClick={() => onLayoutChange("side")}>侧边</Button>
                <Button size="small" type={currentLayout === "bottom" ? "primary" : "text"} icon={<PanelBottom className="size-3.5" />} onClick={() => onLayoutChange("bottom")}>底部</Button>
            </div>
        </div>
    );
}

function WorkbenchSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
    return (
        <section className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm font-medium">{title}</span>
                {typeof count === "number" ? <Tag className="m-0 text-xs">{count}</Tag> : null}
            </div>
            <div className="space-y-2 border-t border-stone-200 p-3 dark:border-stone-800">{children}</div>
        </section>
    );
}

function FrameReferenceStrip({ firstFrame, lastFrame, compact = false, onPasteFrame, onUploadFrame, onOpenAssetPicker, onRemoveFrame }: { firstFrame: ReferenceImage | null; lastFrame: ReferenceImage | null; compact?: boolean; onPasteFrame?: (slot: "first" | "last") => void; onUploadFrame: (slot: "first" | "last") => void; onOpenAssetPicker?: (target?: AssetPickerTarget) => void; onRemoveFrame: (slot: "first" | "last") => void }) {
    if (!compact) {
        return (
            <div className="space-y-2">
                <FrameReferenceRow label="首帧" slot="first" reference={firstFrame} onPasteFrame={onPasteFrame} onUploadFrame={onUploadFrame} onOpenAssetPicker={onOpenAssetPicker} onRemoveFrame={onRemoveFrame} />
                <FrameReferenceRow label="尾帧" slot="last" reference={lastFrame} onPasteFrame={onPasteFrame} onUploadFrame={onUploadFrame} onOpenAssetPicker={onOpenAssetPicker} onRemoveFrame={onRemoveFrame} />
            </div>
        );
    }
    return (
        <div className={`grid grid-cols-2 gap-2 rounded-lg border border-dashed border-stone-300 p-2 dark:border-stone-700 ${compact ? "min-h-14" : "min-h-24"}`}>
            <FrameReferenceSlot label="首帧" reference={firstFrame} compact={compact} onUpload={() => onUploadFrame("first")} onRemove={() => onRemoveFrame("first")} />
            <FrameReferenceSlot label="尾帧" reference={lastFrame} compact={compact} onUpload={() => onUploadFrame("last")} onRemove={() => onRemoveFrame("last")} />
        </div>
    );
}

function FrameReferenceRow({ label, slot, reference, onPasteFrame, onUploadFrame, onOpenAssetPicker, onRemoveFrame }: { label: string; slot: "first" | "last"; reference: ReferenceImage | null; onPasteFrame?: (slot: "first" | "last") => void; onUploadFrame: (slot: "first" | "last") => void; onOpenAssetPicker?: (target?: AssetPickerTarget) => void; onRemoveFrame: (slot: "first" | "last") => void }) {
    return (
        <div className="space-y-2 rounded-lg border border-dashed border-stone-300 p-2 dark:border-stone-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
                <div className="flex flex-wrap gap-1">
                    <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => onPasteFrame?.(slot)}>读取剪贴板</Button>
                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => onUploadFrame(slot)}>上传</Button>
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onOpenAssetPicker?.(slot === "first" ? "firstFrame" : "lastFrame")}>从素材库选择</Button>
                </div>
            </div>
            <FrameReferenceSlot label={label} reference={reference} compact={false} onUpload={() => onUploadFrame(slot)} onRemove={() => onRemoveFrame(slot)} />
        </div>
    );
}

function FrameReferenceSlot({ label, reference, compact, onUpload, onRemove }: { label: string; reference: ReferenceImage | null; compact: boolean; onUpload: () => void; onRemove: () => void }) {
    return (
        <div className={`group relative flex min-w-0 items-center justify-center overflow-hidden rounded-md border border-stone-200 bg-stone-50 text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-900 ${compact ? "h-12" : "h-20"}`}>
            {reference ? (
                <>
                    <img src={reference.dataUrl} alt={reference.name} className="size-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{label}</span>
                    <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">{reference.name}</span>
                    <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={onRemove} aria-label={`移除${label}`}>
                        <Trash2 className="size-3.5" />
                    </button>
                </>
            ) : (
                <button type="button" className="flex size-full items-center justify-center gap-1" onClick={onUpload}>
                    <Upload className="size-3.5" />
                    上传{label}
                </button>
            )}
        </div>
    );
}

function ReferenceImageStrip({ references, compact = false, maxCount = SEEDANCE_REFERENCE_LIMITS.images, onRemoveReference, onMoveReference }: { references: ReferenceImage[]; compact?: boolean; maxCount?: number; onRemoveReference: (id: string) => void; onMoveReference: (index: number, offset: number) => void }) {
    return (
        <div className={`hover-scrollbar hover-scrollbar-hint flex w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 overscroll-x-contain dark:border-stone-700 ${compact ? "min-h-14" : "min-h-24 pb-3"}`}>
            {references.map((item, index) => (
                <div key={item.id} className={`${compact ? "size-12" : "size-20"} group relative shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800`}>
                    <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("image", index)}</span>
                    <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => onMoveReference(index, offset)} />
                    <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => onRemoveReference(item.id)} aria-label="移除参考图">
                        <Trash2 className="size-3.5" />
                    </button>
                </div>
            ))}
            {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图，最多 {maxCount} 张</div> : null}
        </div>
    );
}

function ReferenceVideoStrip({ references, compact = false, maxCount = SEEDANCE_REFERENCE_LIMITS.videos, onRemoveReference, onMoveReference }: { references: ReferenceVideo[]; compact?: boolean; maxCount?: number; onRemoveReference: (id: string) => void; onMoveReference: (index: number, offset: number) => void }) {
    return (
        <div className={`hover-scrollbar hover-scrollbar-hint flex w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 overscroll-x-contain dark:border-stone-700 ${compact ? "min-h-14" : "min-h-24 pb-3"}`}>
            {references.map((item, index) => (
                <div key={item.id} className={`${compact ? "h-12 w-20" : "h-20 w-32"} group relative shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800`}>
                    <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                    <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => onMoveReference(index, offset)} />
                    <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => onRemoveReference(item.id)} aria-label="移除参考视频">
                        <Trash2 className="size-3.5" />
                    </button>
                </div>
            ))}
            {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考视频，最多 {maxCount} 个</div> : null}
        </div>
    );
}

function ReferenceAudioStrip({ references, compact = false, maxCount = SEEDANCE_REFERENCE_LIMITS.audios, onRemoveReference, onMoveReference }: { references: ReferenceAudio[]; compact?: boolean; maxCount?: number; onRemoveReference: (id: string) => void; onMoveReference: (index: number, offset: number) => void }) {
    return (
        <div className={`hover-scrollbar hover-scrollbar-hint flex w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 overscroll-x-contain dark:border-stone-700 ${compact ? "min-h-14" : "min-h-24 pb-3"}`}>
            {references.map((item, index) => (
                <div key={item.id} className={`${compact ? "h-12 w-40" : "h-20 w-48"} group relative flex shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900`}>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                        <Music2 className="size-4 shrink-0" />
                        <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">{seedanceReferenceLabel("audio", index)}</span>
                        <span className="truncate">{item.name}</span>
                    </div>
                    {!compact ? <audio src={item.url} controls className="h-8 w-full" preload="metadata" /> : null}
                    <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => onMoveReference(index, offset)} />
                    <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => onRemoveReference(item.id)} aria-label="移除参考音频">
                        <Trash2 className="size-3.5" />
                    </button>
                </div>
            ))}
            {!references.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">暂无参考音频，最多 {maxCount} 个，mp3/wav，单个 15MB 内</div> : null}
        </div>
    );
}

function ReferenceQuickActions({ imageCount, videoCount, audioCount, onPasteReferences, onUploadReferences }: { imageCount: number; videoCount: number; audioCount: number; onPasteReferences: () => void; onUploadReferences: () => void }) {
    return (
        <div className="flex h-11 items-center gap-1 rounded-xl border border-stone-200 bg-background px-2 dark:border-stone-800">
            {imageCount || videoCount || audioCount ? <span className="min-w-7 text-xs text-stone-500">{imageCount + videoCount + audioCount} 个</span> : null}
            <Button title="读取剪切板" size="small" type="text" icon={<ClipboardPaste className="size-3.5" />} onClick={onPasteReferences} />
            <Button title="上传参考素材" size="small" type="text" icon={<Upload className="size-3.5" />} onClick={onUploadReferences} />
        </div>
    );
}

function TaskCountControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
        <label className="flex h-11 items-center gap-2 rounded-xl border border-stone-200 bg-background px-3 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
            <span className="shrink-0">任务</span>
            <input className="h-7 w-16 rounded-lg border border-stone-200 bg-background px-2 text-sm text-stone-900 outline-none dark:border-stone-800 dark:text-stone-100" type="number" min={1} max={6} value={value} onChange={(event) => onChange(normalizeVideoCount(event.target.value))} />
        </label>
    );
}

function optionPillClass(active: boolean) {
    return [
        "h-9 rounded-full border bg-transparent px-2 text-sm font-medium transition hover:opacity-80",
        active ? "border-stone-950 text-stone-950 dark:border-stone-100 dark:text-stone-100" : "border-stone-200 text-stone-700 dark:border-stone-800 dark:text-stone-200",
    ].join(" ");
}

function QuickSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
    return (
        <label className="grid gap-1 text-xs text-stone-500 dark:text-stone-400">
            {label}
            <select className="h-11 min-w-0 rounded-xl border border-stone-200 bg-background px-3 text-sm text-stone-900 outline-none dark:border-stone-800 dark:text-stone-100" value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((item) => (
                    <option key={item.value} value={item.value}>
                        {item.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function QuickNumber({ label, value, min, max, onChange, clampOnChange = true }: { label: string; value: string; min: number; max: number; onChange: (value: string) => void; clampOnChange?: boolean }) {
    return (
        <label className="grid gap-1 text-xs text-stone-500 dark:text-stone-400">
            {label}
            <input className="h-11 min-w-0 rounded-xl border border-stone-200 bg-background px-3 text-sm text-stone-900 outline-none dark:border-stone-800 dark:text-stone-100" type="number" min={min} max={max} value={value} onChange={(event) => onChange(clampOnChange ? clampQuickNumberValue(event.target.value, min, max) : event.target.value)} onBlur={(event) => onChange(clampQuickNumberValue(event.target.value, min, max))} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
    );
}

function clampQuickNumberValue(value: string, min: number, max: number) {
    const number = Math.floor(Number(value) || min);
    return String(Math.max(min, Math.min(max, number)));
}


function QuickSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="grid gap-1 text-xs text-stone-500 dark:text-stone-400">
            {label}
            <span className="flex h-11 items-center justify-center rounded-xl border border-stone-200 bg-background px-3 dark:border-stone-800">
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </label>
    );
}

function GenerationSettings({ config, model, referenceMode, updateConfig, openConfigDialog }: { config: AiConfig; model: string; referenceMode: "text" | "frames" | "reference"; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-3">
            <WorkbenchSection title="模型">
                <ModelPicker config={config} value={model} channelId={config.videoChannelId} onChange={(value, channelId) => { updateConfig("videoModel", value); if (channelId) updateConfig("videoChannelId", channelId); }} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </WorkbenchSection>
            <VideoSettingsPanel config={config} modelName={model} referenceMode={referenceMode} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-3" />
        </div>
    );
}

function ResultsPanel({
    className = "",
    results,
    logs,
    pendingCount,
    now,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onDeleteLog,
    onPreviewLog,
    onRetryLog,
    onRegenerateLog2K,
    onPreviewResult,
    onRetryResult,
    onCopyPrompt,
    onDownload,
    onSyncResult,
    onSyncLog,
    onSaveAsset,
    syncingVideoIds,
}: {
    className?: string;
    results: GenerationResult[];
    logs: GenerationLog[];
    pendingCount: number;
    now: number;
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onDeleteLog: (log: GenerationLog) => void;
    onPreviewLog: (log: GenerationLog) => void;
    onRetryLog: (log: GenerationLog) => void;
    onRegenerateLog2K: (log: GenerationLog) => void;
    onPreviewResult: (result: GenerationResult) => void;
    onRetryResult: (result: GenerationResult) => void;
    onCopyPrompt: (text: string) => void | Promise<void>;
    onDownload: (video: GeneratedVideo) => void;
    onSyncResult: (resultId: string, video: GeneratedVideo, index: number) => void;
    onSyncLog: (log: GenerationLog, video: GeneratedVideo, index: number) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
    syncingVideoIds: string[];
}) {
    const visibleResults = results.filter((result) => result.status !== "failed" || pendingCount > 0);
    const liveResultKeys = new Set(visibleResults.flatMap(videoResultIdentityKeys));
    const liveLogIds = new Set(visibleResults.flatMap((result) => [result.taskLogId, result.id]).filter((id): id is string => Boolean(id)));
    const visibleLogs = logs.filter((log) => !liveLogIds.has(log.id) && !videoLogIdentityKeys(log).some((key) => liveResultKeys.has(key)));
    const totalCount = visibleResults.length + visibleLogs.length;
    const allSelected = Boolean(visibleLogs.length) && visibleLogs.every((log) => selectedLogIds.includes(log.id));
    const toggleVisibleLogs = () => onSelectedLogIdsChange(allSelected ? selectedLogIds.filter((id) => !visibleLogs.some((log) => log.id === id)) : Array.from(new Set([...selectedLogIds, ...visibleLogs.map((log) => log.id)])));

    return (
        <section className={`thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5 ${className}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <HistoryIcon />
                    <h2 className="truncate text-xl font-semibold">全部成果</h2>
                    <Tag className="m-0">{totalCount}</Tag>
                    {pendingCount ? <Tag className="m-0 px-2 py-1">{pendingCount} 个生成中</Tag> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>新建</Button>
                    <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!visibleLogs.length} onClick={toggleVisibleLogs}>{allSelected ? "取消" : "全选"}</Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>删除</Button>
                </div>
            </div>
            {totalCount ? (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {visibleResults.map((result, index) => (result.status === "success" && result.video ? <ResultVideoCard key={result.id} result={result} video={result.video} index={index} syncing={syncingVideoIds.includes(result.video.id)} onCopyPrompt={onCopyPrompt} onDownload={onDownload} onSync={(video) => onSyncResult(result.id, video, index)} onSaveAsset={onSaveAsset} /> : result.status === "failed" ? <FailedVideoCard key={result.id} result={result} error={result.error || "生成失败"} onCopyPrompt={onCopyPrompt} onPreview={() => onPreviewResult(result)} onRetry={() => onRetryResult(result)} /> : <PendingVideoCard key={result.id} result={result} now={now} onCopyPrompt={onCopyPrompt} />))}
                    {visibleLogs.map((log, index) => (
                        <HistoryLogCard key={log.id} log={log} index={index} selected={selectedLogIds.includes(log.id)} active={activeLogId === log.id} syncing={Boolean(log.video && syncingVideoIds.includes(log.video.id))} onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} onDelete={() => onDeleteLog(log)} onPreview={() => onPreviewLog(log)} onRetry={() => onRetryLog(log)} onRegenerate2K={canRegenerateLog2K(log) ? () => onRegenerateLog2K(log) : undefined} onCopyPrompt={onCopyPrompt} onDownload={onDownload} onSync={(video) => onSyncLog(log, video, index)} onSaveAsset={onSaveAsset} />
                    ))}
                </div>
            ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                    <VideoIcon className="mb-4 size-11 text-stone-400" />
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成视频" />
                </div>
            )}
        </section>
    );
}

function HistoryIcon() {
    return <History className="size-4 shrink-0 text-stone-400" />;
}

function ResultVideoCard({ result, video, index, syncing, onCopyPrompt, onDownload, onSync, onSaveAsset }: { result: GenerationResult; video: GeneratedVideo; index: number; syncing: boolean; onCopyPrompt: (text: string) => void | Promise<void>; onDownload: (video: GeneratedVideo) => void; onSync: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="relative aspect-video bg-black">
                <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
                    <VideoSourceTag video={video} />
                    <Tag className="m-0 text-[10px]" color="blue">成功</Tag>
                </div>
                <ReferenceThumbnailOverlay references={result.references} className="left-1.5 top-1.5" />
                <video src={video.url} controls className="size-full object-contain" />
            </div>
            <TaskInfo item={result} onCopyPrompt={onCopyPrompt} />
            <VideoMetaBar video={video} index={index} syncing={syncing} onDownload={onDownload} onSync={onSync} onSaveAsset={onSaveAsset} />
        </div>
    );
}

function PendingVideoCard({ result, now, onCopyPrompt }: { result: GenerationResult; now: number; onCopyPrompt: (text: string) => void | Promise<void> }) {
    const progress = typeof result.progress === "number" ? Math.max(0, Math.min(100, Math.floor(result.progress))) : null;
    const durationMs = Math.max(0, now - result.createdAt);
    return (
        <div className="overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="relative aspect-video">
                <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)", backgroundSize: "16px 16px" }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                    <LoaderCircle className="size-6 animate-spin" />
                    {progress !== null ? <span className="animate-pulse font-semibold text-sky-500">正在创作 {progress}%</span> : <span>生成中</span>}
                    <span className="rounded-full bg-white/80 px-2 py-1 text-xs text-stone-600 shadow-sm dark:bg-stone-950/70 dark:text-stone-300">{formatDuration(durationMs)}</span>
                </div>
                {progress !== null ? (
                    <div className="absolute inset-x-4 bottom-4 z-10 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[10px] font-medium text-stone-500 dark:text-stone-400">
                            <span>当前创作进度</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                            <div className="h-full rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)] transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                ) : null}
            </div>
            <TaskInfo item={{ ...result, durationMs }} onCopyPrompt={onCopyPrompt} />
        </div>
    );
}

function FailedVideoCard({ result, error, onCopyPrompt, onPreview, onRetry }: { result: GenerationResult; error: string; onCopyPrompt: (text: string) => void | Promise<void>; onPreview: () => void; onRetry: () => void }) {
    const [detailOpen, setDetailOpen] = useState(false);
    const detail = result.errorDetail || error;
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="relative flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <ReferenceThumbnailOverlay references={result.references} className="left-1.5 top-1.5" />
                <AlertCircle className="size-7 text-red-500" />
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <TaskInfo item={result} error={error} onCopyPrompt={onCopyPrompt} />
            <div className="flex justify-between gap-2 border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" onClick={onPreview}>载入</Button>
                <div className="flex gap-2">
                    <Button size="small" onClick={() => setDetailOpen(true)}>详情</Button>
                    <Button size="small" danger onClick={onRetry}>重试</Button>
                </div>
            </div>
            <Modal title="失败详情" open={detailOpen} width={760} onCancel={() => setDetailOpen(false)} footer={null}>
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-stone-950 p-3 text-xs text-stone-100">{detail}</pre>
            </Modal>
        </div>
    );
}

function HistoryLogCard({ log, index, selected, active, syncing, onSelectedChange, onDelete, onPreview, onRetry, onRegenerate2K, onCopyPrompt, onDownload, onSync, onSaveAsset }: { log: GenerationLog; index: number; selected: boolean; active: boolean; syncing: boolean; onSelectedChange: (checked: boolean) => void; onDelete: () => void; onPreview: () => void; onRetry: () => void; onRegenerate2K?: () => void; onCopyPrompt: (text: string) => void | Promise<void>; onDownload: (video: GeneratedVideo) => void; onSync: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const [expanded, setExpanded] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    return (
        <div className={`overflow-hidden rounded-lg border bg-background dark:bg-stone-950 ${active ? "border-stone-900 dark:border-stone-100" : "border-stone-200 dark:border-stone-800"}`}>
            <div className="relative aspect-video bg-stone-100 dark:bg-stone-900">
                <div className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md bg-white/85 px-1.5 py-1 shadow-sm dark:bg-stone-950/80">
                    <Checkbox checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <Button size="small" type="text" danger title="删除" className="!h-6 !w-6 !p-0" icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
                </div>
                <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
                    {log.video ? <VideoSourceTag video={log.video} /> : null}
                    <Tag className="m-0 text-[10px]" color={log.status === "成功" ? "blue" : log.status === "生成中" ? "processing" : "red"}>{log.status}</Tag>
                </div>
                {log.video ? <video src={log.video.url} controls className="size-full bg-black object-contain" /> : <div className="flex size-full flex-col items-center justify-center gap-2 p-5 text-center text-sm text-red-500"><AlertCircle className="size-7" /><span>{log.error || "没有可显示的视频"}</span></div>}
                <ReferenceThumbnailOverlay references={log.references} className="bottom-1.5 right-1.5" />
            </div>
            <div className="space-y-2 border-t border-stone-200 p-2.5 text-xs dark:border-stone-800">
                <div className={`${expanded ? "" : "line-clamp-2"} whitespace-pre-wrap text-stone-700 dark:text-stone-200`}>{log.prompt}</div>
                <div className="flex items-center justify-end gap-1">
                    <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => void onCopyPrompt(log.prompt)}>复制</Button>
                    <Button size="small" type="text" icon={expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</Button>
                </div>
                <div className="flex flex-wrap gap-1">
                    <Tag className="m-0 text-[10px]">{formatLogTime(log.createdAt)}</Tag>
                    <Tag className="m-0 text-[10px]">{log.model}</Tag>
                    <Tag className="m-0 text-[10px]">{log.size}</Tag>
                    <Tag className="m-0 text-[10px]">{log.resolution}p</Tag>
                    <Tag className="m-0 text-[10px]">{log.seconds}s</Tag>
                    <Tag className="m-0 text-[10px]">数量 {log.taskCount || 1}</Tag>
                    <Tag className="m-0 text-[10px]">{formatDuration(log.durationMs)}</Tag>
                </div>
                {log.error ? <div className="flex items-start justify-between gap-2 rounded-md bg-red-100 px-2 py-1 text-red-600 dark:bg-red-950/40 dark:text-red-300"><span className="line-clamp-2 min-w-0">{log.error}</span><Button size="small" type="text" className="!h-auto !p-0 text-xs" onClick={() => setDetailOpen(true)}>详情</Button></div> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-stone-200 px-2.5 py-2 dark:border-stone-800">
                <div className="flex flex-wrap gap-1">
                    <Button size="small" onClick={onPreview}>载入</Button>
                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>重试</Button>
                    {onRegenerate2K ? <Button size="small" icon={<Sparkles className="size-3.5" />} onClick={onRegenerate2K}>2K 重生成</Button> : null}
                </div>
                {log.video ? <div className="flex shrink-0 gap-1"><Button size="small" title="同步到云端存储" icon={<CloudUpload className="size-3.5" />} loading={syncing} disabled={isCloudVideo(log.video)} onClick={() => onSync(log.video!)} /><Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(log.video!)} /><Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(log.video!)} /></div> : null}
            </div>
            <Modal title="失败详情" open={detailOpen} width={760} onCancel={() => setDetailOpen(false)} footer={null}>
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-stone-950 p-3 text-xs text-stone-100">{log.errorDetail || log.error || "没有详情"}</pre>
            </Modal>
        </div>
    );
}

function VideoMetaBar({ video, syncing, onDownload, onSync, onSaveAsset }: { video: GeneratedVideo; index: number; syncing: boolean; onDownload: (video: GeneratedVideo) => void; onSync: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-stone-200 px-2.5 py-2 dark:border-stone-800">
            <div className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1 text-[10px] text-stone-500 dark:text-stone-400">
                <span>{video.width}x{video.height}</span>
                {video.bytes ? <span>{formatBytes(video.bytes)}</span> : <span>远端地址</span>}
                <span>{formatDuration(video.durationMs)}</span>
            </div>
            <div className="flex shrink-0 gap-1">
                <Button size="small" title="同步到云端存储" icon={<CloudUpload className="size-3.5" />} loading={syncing} disabled={isCloudVideo(video)} onClick={() => onSync(video)} />
                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)} />
                <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)} />
            </div>
        </div>
    );
}

function VideoSourceTag({ video }: { video: GeneratedVideo }) {
    return <Tag className="m-0 text-[10px]" color={video.storageKey ? "default" : "gold"}>{video.storageKey ? "本地缓存" : "AI 临时URL"}</Tag>;
}

function TaskInfo({ item, error, onCopyPrompt }: { item: GenerationResult; error?: string; onCopyPrompt: (text: string) => void | Promise<void> }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
            <div className="rounded-md bg-stone-50 p-2 dark:bg-stone-900">
                <div className={`${expanded ? "" : "line-clamp-2"} whitespace-pre-wrap text-stone-700 dark:text-stone-200`}>{item.prompt}</div>
                <div className="mt-2 flex justify-end gap-1">
                    <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => void onCopyPrompt(item.prompt)}>复制</Button>
                    <Button size="small" type="text" icon={expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</Button>
                </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Tag className="m-0">{formatLogTime(item.createdAt)}</Tag>
                <Tag className="m-0">{item.model}</Tag>
                <Tag className="m-0">{item.config.size || "auto"}</Tag>
                <Tag className="m-0">{videoResolutionLabel(item.config.vquality)}</Tag>
                <Tag className="m-0">{item.config.videoSeconds || "6"}s</Tag>
                <Tag className="m-0">数量 {item.taskCount || 1}</Tag>
                {item.durationMs ? <Tag className="m-0">{formatDuration(item.durationMs)}</Tag> : null}
            </div>
            {error ? <div className="rounded-md bg-red-100 px-2 py-1.5 text-red-600 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
        </div>
    );
}

function ReferenceThumbnailOverlay({ references, className = "" }: { references?: ReferenceImage[]; className?: string }) {
    const visibleReferences = (references || []).filter((item) => Boolean(item.dataUrl)).slice(0, 3);
    if (!visibleReferences.length) return null;
    return (
        <div className={`absolute z-10 flex items-center gap-1 rounded-md bg-black/55 p-1 shadow-sm backdrop-blur ${className}`}>
            {visibleReferences.map((item) => (
                <img key={item.id} src={item.dataUrl} alt={item.name} className="size-7 rounded border border-white/60 object-cover" />
            ))}
            {(references || []).length > visibleReferences.length ? <span className="px-1 text-[10px] text-white">+{(references || []).length - visibleReferences.length}</span> : null}
        </div>
    );
}

function createResultFromSnapshot(id: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[]; firstFrame?: ReferenceImage | null; lastFrame?: ReferenceImage | null; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[]; taskCount?: number }, model: string, status: GenerationResult["status"], extra: Partial<GenerationResult> = {}): GenerationResult {
    return {
        id,
        status,
        createdAt: Date.now(),
        prompt: snapshot.text,
        model,
        config: buildDisplayConfig(snapshot.config, model),
        references: snapshot.references,
        firstFrame: snapshot.firstFrame || null,
        lastFrame: snapshot.lastFrame || null,
        videoReferences: snapshot.videoReferences,
        audioReferences: snapshot.audioReferences,
        taskCount: snapshot.taskCount,
        ...extra,
    };
}

function createResultFromLog(log: GenerationLog, status: GenerationResult["status"]): GenerationResult {
    return {
        id: log.video?.id || log.id,
        status,
        taskLogId: log.id,
        createdAt: log.createdAt,
        prompt: log.prompt,
        model: log.model,
        config: log.config,
        references: log.references || [],
        firstFrame: log.firstFrame || null,
        lastFrame: log.lastFrame || null,
        videoReferences: log.videoReferences || [],
        audioReferences: log.audioReferences || [],
        baseVideo: log.baseVideo,
        taskCount: log.taskCount,
        durationMs: log.durationMs,
        progress: log.task?.progress,
        task: log.task,
        video: log.video,
        error: log.error,
        errorDetail: log.errorDetail,
        lastPolledAt: log.lastPolledAt,
    };
}

function buildDisplayConfig(config: AiConfig, model: string): GenerationLogConfig {
    return {
        channelMode: config.channelMode,
        activeChannelId: config.activeChannelId,
        videoChannelId: config.videoChannelId,
        model: config.model,
        videoModel: config.videoModel || model,
        size: config.size,
        vquality: config.vquality,
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
}

async function copyPrompt(text: string, success: (content: string) => void) {
    await navigator.clipboard.writeText(text);
    success("提示词已复制");
}

function formatLogTime(value: number) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function replaceStoredVideoHistory(logs: GenerationLog[]) {
    if (typeof window === "undefined") return;
    await persistStoredVideoLogs(logs);
    const keepIds = new Set(logs.map((log) => log.id));
    const storedKeys = await logStore.keys();
    await Promise.all(storedKeys.filter((key) => !keepIds.has(key)).map((key) => logStore.removeItem(key)));
}

async function persistStoredVideoLogs(logs: GenerationLog[]) {
    if (typeof window === "undefined" || !logs.length) return;
    await Promise.all(
        logs.map(async (log) => {
            const serialized = serializeLog(log);
            const current = await logStore.getItem<GenerationLog>(log.id);
            if (current && JSON.stringify(current) === JSON.stringify(serialized)) return;
            await logStore.setItem(log.id, serialized);
        }),
    );
}

async function mergeVideoLogs(remoteLogs: GenerationLog[], localLogs: GenerationLog[]) {
    const normalizedRemote = (await normalizeLogsSafely(remoteLogs)).filter(shouldSyncVideoLog);
    const normalizedLocal = await normalizeLogsSafely(localLogs);
    const remoteKeys = new Set(normalizedRemote.flatMap(videoLogIdentityKeys));
    const preservedLocal = normalizedLocal.filter((log) => shouldPreserveLocalLogDuringRemoteMerge(log, remoteKeys));
    return dedupeVideoLogs([...normalizedRemote, ...preservedLocal]);
}

function shouldPreserveLocalLogDuringRemoteMerge(log: GenerationLog, remoteKeys: Set<string>) {
    if (!isLocalClientVideoLog(log) && !(log.status === "生成中" && !log.video)) return false;
    const keys = videoLogIdentityKeys(log);
    return !keys.length || !keys.some((key) => remoteKeys.has(key));
}

function shouldSyncVideoLog(log: GenerationLog) {
    return !isLocalClientVideoLog(log);
}

function dedupeVideoLogs(logs: GenerationLog[]) {
    const merged: GenerationLog[] = [];
    for (const log of logs) {
        const index = merged.findIndex((item) => videoLogsShareIdentity(item, log));
        if (index < 0) {
            merged.push(log);
        } else {
            merged[index] = mergeDuplicateVideoLog(merged[index], log);
        }
    }
    return sortVideoLogs(merged);
}

function videoLogsShareIdentity(a: GenerationLog, b: GenerationLog) {
    if (a.id && b.id && a.id === b.id) return true;
    const aKeys = videoLogIdentityKeys(a);
    if (!aKeys.length) return false;
    const bKeys = new Set(videoLogIdentityKeys(b));
    return aKeys.some((key) => bKeys.has(key));
}

function mergeDuplicateVideoLog(existing: GenerationLog, incoming: GenerationLog) {
    const preferred = shouldPreferVideoLog(incoming, existing) ? incoming : existing;
    const fallback = preferred === incoming ? existing : incoming;
    return {
        ...fallback,
        ...preferred,
        prompt: preferred.prompt || fallback.prompt,
        title: preferred.title || fallback.title,
        references: preferred.references?.length ? preferred.references : fallback.references,
        firstFrame: preferred.firstFrame || fallback.firstFrame,
        lastFrame: preferred.lastFrame || fallback.lastFrame,
        videoReferences: preferred.videoReferences?.length ? preferred.videoReferences : fallback.videoReferences,
        audioReferences: preferred.audioReferences?.length ? preferred.audioReferences : fallback.audioReferences,
        task: preferred.task && !isLocalClientVideoTask(preferred.task) ? preferred.task : fallback.task,
        video: preferred.video || fallback.video,
        error: preferred.error || fallback.error,
        errorDetail: preferred.errorDetail || fallback.errorDetail,
        durationMs: Math.max(preferred.durationMs || 0, fallback.durationMs || 0),
        lastPolledAt: Math.max(preferred.lastPolledAt || 0, fallback.lastPolledAt || 0) || undefined,
    };
}

function shouldPreferVideoLog(next: GenerationLog, current: GenerationLog) {
    const nextScore = videoLogScore(next);
    const currentScore = videoLogScore(current);
    if (nextScore !== currentScore) return nextScore > currentScore;
    return (next.createdAt || 0) >= (current.createdAt || 0);
}

function mergeBackendVideoTasks(localLogs: GenerationLog[], tasks: VideoResponse[], fallbackConfig: AiConfig) {
    const byKey = new Map<string, GenerationLog>();
    for (const log of localLogs) {
        for (const key of videoLogBackendMergeKeys(log)) byKey.set(key, log);
    }
    const merged = [...localLogs];
    for (const task of tasks) {
        const incoming = backendTaskToLog(task, fallbackConfig);
        const existing = videoTaskIdentityKeys(task).map((key) => byKey.get(key)).find(Boolean);
        const nextLog = mergeBackendTaskIntoLog(existing, incoming, task);
        if (existing) {
            const index = merged.findIndex((item) => item.id === existing.id);
            if (index >= 0) merged[index] = nextLog;
        } else {
            merged.push(nextLog);
        }
        for (const key of videoLogIdentityKeys(nextLog)) byKey.set(key, nextLog);
    }
    return sortVideoLogs(merged);
}

function videoLogBackendMergeKeys(log: GenerationLog) {
    const keys = videoLogIdentityKeys(log);
    if (isLocalClientVideoLog(log)) {
        [log.task?.id, log.task?.task_id].forEach((id) => {
            if (isClientVideoTaskId(id)) keys.push(id);
        });
    }
    return Array.from(new Set(keys.filter((key): key is string => Boolean(key))));
}

function backendTaskToLog(task: VideoResponse, fallbackConfig: AiConfig): GenerationLog {
    const request = parseBackendVideoRequest(task.request_body);
    const model = (task.model === MINIMAX_REGENERATION_MODEL ? "MiniMax-H3" : task.model) || request.model || fallbackConfig.videoModel || fallbackConfig.model || "";
    const taskChannelId = videoTaskChannelId(task);
    const config = buildVideoConfig({ ...fallbackConfig, model, videoModel: model, activeChannelId: taskChannelId || fallbackConfig.activeChannelId, videoChannelId: taskChannelId || fallbackConfig.videoChannelId, size: request.size || fallbackConfig.size, vquality: request.resolution || fallbackConfig.vquality, videoSeconds: request.seconds || fallbackConfig.videoSeconds}, model);
    const createdAt = parseTaskTimestamp(task.createdAt ?? task.created_at) || Date.now();
    const status = isFailedTask(task.status) ? "失败" : isCompletedVideoTask(task) ? "成功" : "生成中";
    const durationMs = Math.max(0, Date.now() - createdAt);
    const video = status === "成功" && (task.video_url || task.url) ? videoFromTaskResponse(task, durationMs) : undefined;
    return {
        id: `backend-${videoTaskIdentityKeys(task)[0] || nanoid()}`,
        createdAt,
        title: (request.prompt || model || "视频任务").slice(0, 12) || "视频任务",
        prompt: request.prompt || "",
        time: new Date(createdAt).toLocaleString("zh-CN", { hour12: false }),
        model,
        config,
        references: [],
        firstFrame: null,
        lastFrame: null,
        videoReferences: [],
        audioReferences: [],
        baseVideo: request.baseVideoUrl ? { id: "base-video", name: "base-video.mp4", type: "video/mp4", url: request.baseVideoUrl } : undefined,
        durationMs,
        size: task.size || request.size || config.size,
        resolution: request.resolution || config.vquality,
        seconds: task.seconds || request.seconds || config.videoSeconds,
        status,
        task,
        video,
        error: status === "失败" ? task.error?.message || "视频生成失败" : undefined,
        errorDetail: status === "失败" ? errorDetail(new VideoRequestError(task.error?.message || "视频生成失败", task)) : undefined,
        lastPolledAt: Date.now(),
    };
}

function mergeBackendTaskIntoLog(existing: GenerationLog | undefined, incoming: GenerationLog, task: VideoResponse): GenerationLog {
    if (!existing) return incoming;
    const durationMs = Math.max(existing.durationMs || 0, incoming.durationMs || 0);
    const baseConfig = { ...existing.config, videoChannelId: incoming.config.videoChannelId || existing.config.videoChannelId, activeChannelId: incoming.config.activeChannelId || existing.config.activeChannelId };
    const base = { ...existing, task, config: baseConfig, durationMs, lastPolledAt: Date.now() };
    if (existing.status === "成功" || existing.video) {
        return { ...base, status: "成功", video: existing.video || incoming.video, error: undefined, errorDetail: undefined };
    }
    if (incoming.status === "失败") {
        return { ...base, status: "失败", error: incoming.error, errorDetail: incoming.errorDetail };
    }
    if (incoming.status === "成功" && incoming.video) {
        return { ...base, status: "成功", video: existing.video || incoming.video, error: undefined, errorDetail: undefined };
    }
    return { ...base, status: "生成中", error: undefined, errorDetail: undefined };
}

function parseBackendVideoRequest(value?: string) {
    const parsed = parseJsonRecord(value);
    const fields = parseRecord(parsed.fields);
    const pick = (...keys: string[]) => {
        for (const key of keys) {
            const source = fields && key in fields ? fields[key] : parsed[key];
            const value = fieldString(source);
            if (value) return value;
        }
        return "";
    };
    return {
        prompt: pick("prompt") || (Array.isArray(parsed.content) ? parsed.content.map((item) => fieldString(parseRecord(item)?.text)).filter(Boolean).join("\n\n") : ""),
        model: pick("model"),
        size: pick("ratio", "size", "aspect_ratio"),
        resolution: pick("resolution") || normalizeVideoResolutionValue(pick("resolution_name", "vquality", "quality")),
        seconds: pick("seconds", "duration", "videoSeconds"),
        baseVideoUrl: Array.isArray(parsed.content) ? fieldString(parseRecord(parseRecord(parsed.content.find((item) => parseRecord(item)?.role === "base_video"))?.video_url)?.url) : "",
    };
}

function parseJsonRecord(value?: string): Record<string, unknown> {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parseRecord(parsed) || {};
    } catch {
        return {};
    }
}

function parseRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fieldString(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return fieldString(value[0]);
    return "";
}

function parseTaskTimestamp(value: unknown) {
    if (typeof value === "number") return value > 1e12 ? value : value * 1000;
    if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric : numeric * 1000;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function isClientVideoTaskId(id?: string | null): id is string {
    return typeof id === "string" && id.startsWith("client_video_task_");
}

function normalizeVideoIdentityKey(key?: string | null) {
    const value = typeof key === "string" ? key.trim() : "";
    return value && !isClientVideoTaskId(value) ? value : "";
}

function videoTaskIdentityKeys(task?: VideoResponse | null) {
    const allowClientTaskId = hasBackendVideoTaskBinding(task);
    const normalizeTaskKey = (key?: string | null) => {
        const value = typeof key === "string" ? key.trim() : "";
        return value && (allowClientTaskId || !isClientVideoTaskId(value)) ? value : "";
    };
    return Array.from(new Set([normalizeTaskKey(task?.id), normalizeTaskKey(task?.task_id), normalizeTaskKey(task?.video_id)].filter((key): key is string => Boolean(key))));
}

function hasBackendVideoTaskBinding(task?: VideoResponse | null) {
    if (!task) return false;
    const record = task as Record<string, unknown>;
    const taskId = typeof task.task_id === "string" ? task.task_id.trim() : "";
    const videoId = typeof task.video_id === "string" ? task.video_id.trim() : "";
    return Boolean(
        (taskId && !isClientVideoTaskId(taskId)) ||
        (videoId && !isClientVideoTaskId(videoId)) ||
        task.video_url ||
        task.url ||
        task.request_body ||
        record.response_body ||
        record.responseBody ||
        record.last_response ||
        record.lastResponse
    );
}

function isLocalClientVideoTask(task?: VideoResponse | null) {
    return Boolean(task && [task.id, task.task_id].some(isClientVideoTaskId) && !hasBackendVideoTaskBinding(task));
}

function isLocalClientVideoLog(log: GenerationLog) {
    return isLocalClientVideoTask(log.task);
}

function videoLogIdentityKeys(log: GenerationLog) {
    return Array.from(new Set([...videoTaskIdentityKeys(log.task), normalizeVideoIdentityKey(log.video?.id)].filter((key): key is string => Boolean(key))));
}

function videoResultIdentityKeys(result: GenerationResult) {
    return Array.from(new Set([...videoTaskIdentityKeys(result.task), normalizeVideoIdentityKey(result.video?.id)].filter((key): key is string => Boolean(key))));
}

function videoLogDeleteKeys(log: GenerationLog) {
    return Array.from(new Set([log.id, log.task?.id, log.task?.task_id, log.task?.video_id, log.video?.id].filter((key): key is string => Boolean(typeof key === "string" && key.trim())).map((key) => key.trim())));
}

function videoLogScore(log: GenerationLog) {
    return (log.status === "成功" ? 4 : 0) + (log.video ? 4 : 0) + (log.video?.storageKey ? 2 : 0) + (log.task && !isLocalClientVideoTask(log.task) ? 2 : 0) + (log.errorDetail ? 1 : 0);
}

function referenceUsedByGeneration(reference: ReferenceImage, logs: GenerationLog[], results: GenerationResult[]) {
    if (!reference.storageKey) return false;
    return logs.some((log) => [log.firstFrame, log.lastFrame, ...log.references].some((item) => item?.storageKey === reference.storageKey)) || results.some((result) => [result.firstFrame, result.lastFrame, ...result.references].some((item) => item?.storageKey === reference.storageKey));
}

function mediaReferenceUsedByGeneration(storageKey: string, logs: GenerationLog[], results: GenerationResult[]) {
    return logs.some((log) => [...log.videoReferences, ...log.audioReferences].some((item) => item.storageKey === storageKey)) || results.some((result) => [...result.videoReferences, ...result.audioReferences].some((item) => item.storageKey === storageKey));
}

function generationLogStorageKeys(log: GenerationLog) {
    return {
        media: [log.video?.storageKey, ...log.videoReferences.map((item) => item.storageKey), ...log.audioReferences.map((item) => item.storageKey)].filter((key): key is string => Boolean(key)),
        images: [log.firstFrame?.storageKey, log.lastFrame?.storageKey, ...log.references.map((image) => image.storageKey)].filter((key): key is string => Boolean(key)),
    };
}

function disposableLogStorageKeys(deletedLogs: GenerationLog[], remainingLogs: GenerationLog[], currentReferences: ReferenceImage[], currentMediaReferences: Array<ReferenceVideo | ReferenceAudio>, results: GenerationResult[]) {
    const deleted = deletedLogs.reduce(
        (keys, log) => {
            const next = generationLogStorageKeys(log);
            next.media.forEach((key) => keys.media.add(key));
            next.images.forEach((key) => keys.images.add(key));
            return keys;
        },
        { media: new Set<string>(), images: new Set<string>() },
    );
    const retained = remainingLogs.reduce(
        (keys, log) => {
            const next = generationLogStorageKeys(log);
            next.media.forEach((key) => keys.media.add(key));
            next.images.forEach((key) => keys.images.add(key));
            return keys;
        },
        { media: new Set<string>(), images: new Set<string>() },
    );
    currentReferences.forEach((reference) => {
        if (reference.storageKey) retained.images.add(reference.storageKey);
    });
    currentMediaReferences.forEach((reference) => {
        if (reference.storageKey) retained.media.add(reference.storageKey);
    });
    results.forEach((result) => {
        if (result.video?.storageKey) retained.media.add(result.video.storageKey);
        [...result.videoReferences, ...result.audioReferences].forEach((reference) => {
            if (reference.storageKey) retained.media.add(reference.storageKey);
        });
        [result.firstFrame, result.lastFrame, ...result.references].forEach((reference) => {
            if (reference?.storageKey) retained.images.add(reference.storageKey);
        });
    });
    return { media: [...deleted.media].filter((key) => !retained.media.has(key)), images: [...deleted.images].filter((key) => !retained.images.has(key)) };
}

function updateResult(results: GenerationResult[], id: string, next: Partial<GenerationResult>) {
    return results.map((item) => (item.id === id ? { ...item, ...next } : item));
}

function updateResultByLogId(results: GenerationResult[], logId: string, next: Partial<GenerationResult>) {
    return results.map((item) => (item.taskLogId === logId || item.id === logId ? { ...item, ...next } : item));
}

function mergePendingLogResults(results: GenerationResult[], logs: GenerationLog[]) {
    const updatedResults = results.map((result) => {
        const log = findMatchingPendingLogForResult(result, logs);
        if (!log) return result;
        return { ...result, taskLogId: log.id, task: log.task, progress: log.task?.progress ?? result.progress, durationMs: log.durationMs || result.durationMs, lastPolledAt: log.lastPolledAt || result.lastPolledAt };
    });
    const existingLogIds = new Set(updatedResults.flatMap((item) => [item.taskLogId, item.id]).filter((id): id is string => Boolean(id)));
    const existingTaskKeys = new Set(updatedResults.flatMap(videoResultIdentityKeys));
    const pendingResults = logs.filter((log) => !existingLogIds.has(log.id) && !videoLogIdentityKeys(log).some((key) => existingTaskKeys.has(key))).map((log) => createResultFromLog(log, "pending"));
    return pendingResults.length ? sortVideoResults([...pendingResults, ...updatedResults]) : sortVideoResults(updatedResults);
}

function findMatchingPendingLogForResult(result: GenerationResult, logs: GenerationLog[]) {
    const resultKeys = new Set(videoResultIdentityKeys(result));
    return logs.find((log) => log.id === result.taskLogId || log.id === result.id || videoLogIdentityKeys(log).some((key) => resultKeys.has(key)));
}

function sortVideoResults(results: GenerationResult[]) {
    return [...results].sort((a, b) => b.createdAt - a.createdAt);
}

function sortVideoLogs(logs: GenerationLog[]) {
    return [...logs].sort((a, b) => b.createdAt - a.createdAt);
}

function videoFromTaskResponse(task: VideoResponse, durationMs: number): GeneratedVideo {
    const size = parseTaskVideoSize((task as Record<string, unknown>).size);
    return {
        id: task.id || task.video_id || task.task_id || nanoid(),
        url: task.video_url || task.url || "",
        storageKey: task.storageKey || "",
        durationMs,
        width: size.width,
        height: size.height,
        bytes: 0,
        mimeType: "video/mp4",
    };
}

function parseTaskVideoSize(value: unknown) {
    const match = typeof value === "string" ? value.match(/^(\d+)x(\d+)$/) : null;
    return { width: match ? Number(match[1]) : 1280, height: match ? Number(match[2]) : 720 };
}

function isTransientVideoPollError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    return !error.response || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRecoverableBackendVideoTask(task: VideoResponse) {
    return !isCompletedVideoTask(task) && !isFailedTask(task.status);
}

function isCloudVideo(video: GeneratedVideo) {
    return Boolean(video.storageKey);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "生成失败";
}

function errorDetail(error: unknown) {
    if (error instanceof VideoRequestError && error.detail) return error.detail;
    if (error instanceof Error) return error.stack || error.message;
    try {
        return JSON.stringify(error, null, 2);
    } catch {
        return String(error || "生成失败");
    }
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await normalizeLogsSafely(logs)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLogsSafely(logs: Array<Partial<GenerationLog>>) {
    const normalized = await Promise.all(
        logs.map(async (log) => {
            try {
                return await normalizeLog(log);
            } catch {
                return null;
            }
        }),
    );
    return normalized.filter((log): log is GenerationLog => Boolean(log));
}

async function safeResolveMediaUrl(storageKey: string, fallback: string) {
    try {
        return await resolveMediaUrl(storageKey, fallback);
    } catch {
        return fallback;
    }
}

async function safeResolveImageUrl(storageKey: string | undefined, fallback: string) {
    try {
        return await resolveImageUrl(storageKey, fallback);
    } catch {
        return fallback;
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await safeResolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await safeResolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await safeResolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await safeResolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const firstFrame = log.firstFrame ? { ...log.firstFrame, dataUrl: await safeResolveImageUrl(log.firstFrame.storageKey, log.firstFrame.dataUrl) } : null;
    const lastFrame = log.lastFrame ? { ...log.lastFrame, dataUrl: await safeResolveImageUrl(log.lastFrame.storageKey, log.lastFrame.dataUrl) } : null;
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        firstFrame,
        lastFrame,
        videoReferences,
        audioReferences,
        taskCount: log.taskCount,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeVideoResolutionValue(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        video,
        error: log.error,
        errorDetail: log.errorDetail,
        lastPolledAt: log.lastPolledAt,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        firstFrame: log.firstFrame?.storageKey ? { ...log.firstFrame, dataUrl: "" } : log.firstFrame,
        lastFrame: log.lastFrame?.storageKey ? { ...log.lastFrame, dataUrl: "" } : log.lastFrame,
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        config: log.config,
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function seedanceReferenceLimits(config: AiConfig, model: string) {
    return channelProtocolForConfig({ ...config, model, videoModel: model }) === "ark" && modelKey(model).includes("seedance-2-5") ? ARK_SEEDANCE_REFERENCE_LIMITS : SEEDANCE_REFERENCE_LIMITS;
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], limits: typeof SEEDANCE_REFERENCE_LIMITS, warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > limits.maxDurationMs)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > limits.totalDurationMs) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn(`已忽略不符合时长要求的参考音频：单个 2-${limits.maxDurationMs / 1000} 秒，总时长不超过 ${limits.totalDurationMs / 1000} 秒`);
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    const taskChannelId = videoTaskChannelId(log.task);
    return {
        channelMode: log.config?.channelMode || "local",
        activeChannelId: taskChannelId || log.config?.activeChannelId || log.config?.videoChannelId || "",
        videoChannelId: taskChannelId || log.config?.videoChannelId || log.config?.activeChannelId || "",
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: log.config?.vquality || log.resolution || "",
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "false",
        videoWatermark: log.config?.videoWatermark || "false",
    };
}

function buildLog({ prompt, model, config, references, firstFrame, lastFrame, videoReferences, audioReferences, baseVideo, taskCount, durationMs, status, task, video, error, errorDetail, lastPolledAt }: { prompt: string; model: string; config: AiConfig; references: ReferenceImage[]; firstFrame?: ReferenceImage | null; lastFrame?: ReferenceImage | null; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[]; baseVideo?: ReferenceVideo | null; taskCount?: number; durationMs: number; status: GenerationLog["status"]; task?: VideoResponse; video?: GeneratedVideo; error?: string; errorDetail?: string; lastPolledAt?: number }): GenerationLog {
    const logConfig = {
        channelMode: config.channelMode,
        activeChannelId: config.activeChannelId,
        videoChannelId: config.videoChannelId,
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: config.vquality,
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        firstFrame: firstFrame || null,
        lastFrame: lastFrame || null,
        videoReferences,
        audioReferences,
        baseVideo,
        taskCount,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
        errorDetail,
        lastPolledAt,
    };
}

function buildVideoConfig(config: AiConfig, model: string, mode?: "text" | "frames" | "reference"): AiConfig {
    const videoChannelId = resolveVideoChannelId(config, model, config.videoChannelId, config.activeChannelId);
    return normalizeVideoConfig({ ...config, model, videoModel: model, videoChannelId, activeChannelId: videoChannelId }, mode);
}

function videoTaskChannelId(task?: VideoResponse | null) {
    return task?.userChannelId || task?.channelId || "";
}

function canRegenerateLog2K(log: GenerationLog) {
    return log.status === "成功" && Boolean(log.video) && isMiniMaxH3BaseModel(log.model) && normalizeMiniMaxH3Resolution(log.resolution, log.model) === "768P";
}

function resolveVideoChannelId(config: AiConfig, model: string, ...preferredIds: Array<string | undefined>) {
    const channels = config.channelMode === "remote"
        ? config.publicChannels.map((channel) => ({ id: channel.id || "", models: channel.models || [] }))
        : normalizeLocalChannels(config).map((channel) => ({ id: channel.id, models: channel.models }));
    for (const id of preferredIds) {
        const channelId = (id || "").trim();
        if (channelId && channels.some((channel) => channel.id === channelId && channel.models.includes(model))) return channelId;
    }
    return channels.find((channel) => channel.models.includes(model))?.id || "";
}


function normalizeVideoCount(value: string | number) {
    const count = Math.floor(Number(value) || 1);
    return Math.max(1, Math.min(6, count));
}

function buildResumeVideoConfig(config: AiConfig, log: GenerationLog): AiConfig {
    return buildVideoConfig({ ...config, ...log.config, model: log.model, videoModel: log.model }, log.model);
}

function videoLogTaskId(log: GenerationLog) {
    return log.task?.id || log.task?.video_id || log.task?.task_id || "";
}
